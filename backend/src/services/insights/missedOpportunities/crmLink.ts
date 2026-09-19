/**
 * Resolve the CRM records behind a reviewed sales call.
 *
 * WHY THIS EXISTS. Genesys carries no TaskID/TicketID and the CRM carries no
 * ConversationID (the gap `CallTicketLinkerService` documents), so without this
 * the model could only be shown the salesperson's WHOLE DAY of notes matched by
 * name — never the account's own history. And without that history you cannot
 * tell a genuine miss from a step the lead already documents as done.
 *
 * WHAT CHANGED AFTER SEPTEMBER 17. The previous version resolved the wrong
 * records and then presented them confidently: it unioned every phone number on
 * the conversation (ours included), read `CompletedOn IS NULL` on a NOT NULL
 * column so every closed task looked open, never expanded through the CustomerID
 * that owns the account's Contact Manager, treated `CustomerLeadID = 0` as a
 * shared lead, never followed a duplicate closure, and called a single returned
 * candidate a strong match. Lakeland and Keys both attached to an unrelated La
 * Mesa task on that basis. The pipeline is now:
 *
 *   crmPhone      which number is the CUSTOMER's, with provenance
 *   crmDiscover   candidates through verified contact / lead / customer links
 *   crmSelect     which candidate, with an explicit outcome and rejects
 *   crmDuplicate  follow a duplicate closure to the record that carries the work
 *   crmThread     the full bounded history, with coverage and time buckets
 *
 * THE OUTCOME IS PART OF THE ANSWER. `verified` means the phone match is
 * independently corroborated by the call itself and is the ONLY outcome allowed to
 * override the model's own citation. Everything else — provisional, ambiguous,
 * unmatched, unavailable — is reported as such, to the prompt and to the log, so a
 * weak match can no longer be stored as an established link.
 *
 * Every query degrades rather than throwing: a CRM hiccup costs one call its
 * history, never the run.
 */
import logger from '../../../config/logger';
import { endOfCallDay } from './crmDates';
import {
  findTaskCandidates, findTicketCandidates, loadAccountIdentity, resolveContactIds,
} from './crmDiscover';
import { traceDuplicateSuccessors } from './crmDuplicate';
import { resolveExternalNumbers } from './crmPhone';
import { selectSalesRecords, toSalesRecord, type SalesRecord } from './crmSelect';
import { renderSalesThread, renderTicketContext } from './crmThread';
import {
  CallAttribution, CallCandidate, CrmDayActivity, CrmRefKind, CrmResolutionSummary,
  ResolutionOutcome, crmRefToken,
} from './types';

export { resolveContactIds } from './crmDiscover';

/** Tickets carried as operational context. Newest first; this is not sales history. */
const MAX_TICKETS = 3;

export interface ResolvedCrmRecord {
  /** The record a finding should cite; null when none was established. */
  kind: CrmRefKind | null;
  id: number | null;
  outcome: ResolutionOutcome;
  /** The rendered record set, coverage and resolution trail for the prompt. */
  crm: CrmDayActivity;
  /**
   * Whether an internal transcript turn belongs to the reviewed salesperson.
   * Comes from the same session read as the phone numbers, so it is available
   * even when no CRM record resolves — an unattributable call still must not be
   * graded as though every "Agent" line were the reviewed person's.
   */
  attribution: CallAttribution;
}

const UNKNOWN_ATTRIBUTION: CallAttribution = {
  internalPartyCount: null,
  soleInternalParty: false,
};

function attributionFrom(internalPartyCount: number | null): CallAttribution {
  return { internalPartyCount, soleInternalParty: internalPartyCount === 1 };
}

/** Everything the caller may hand us to corroborate identity beyond the number. */
export interface ResolveContext {
  /** Rendered transcript plus any phone-side label, for name corroboration. */
  callText?: string;
}

function emptyResolution(over: Partial<CrmResolutionSummary>): CrmResolutionSummary {
  return {
    outcome: 'unmatched',
    reason: '',
    primaryRef: null,
    salesRefs: [],
    ticketRefs: [],
    duplicatePath: [],
    rejected: [],
    numbers: [],
    crossAccount: false,
    ...over,
  };
}

function failed(
  outcome: ResolutionOutcome,
  reason: string,
  resolution: CrmResolutionSummary,
  attribution: CallAttribution = UNKNOWN_ATTRIBUTION,
): ResolvedCrmRecord {
  return {
    kind: null,
    id: null,
    outcome,
    attribution,
    crm: {
      notes: '',
      refs: [],
      scope: 'record',
      resolution: { ...resolution, outcome, reason },
      ...(outcome === 'unavailable' ? { unavailable: true } : {}),
    },
  };
}

/**
 * The sales grading record set, the operational tickets, and why.
 *
 * Never null: a caller has to be able to tell "no record on this account" from
 * "the lookup failed" from "several accounts we could not separate", and a null
 * return collapsed all three into the same silent fallback.
 */
export async function resolveCallCrmRecord(
  candidate: CallCandidate,
  context: ResolveContext = {},
): Promise<ResolvedCrmRecord> {
  const callText = [context.callText ?? '', candidate.remoteParty ?? ''].join('\n');
  const notAfter = endOfCallDay(candidate.startedAt);

  const phone = await resolveExternalNumbers(candidate.conversationId);
  const numbers = phone.numbers.map((n) => ({ digits: n.digits, source: n.source }));
  const base = emptyResolution({ numbers });
  const attribution = attributionFrom(phone.internalPartyCount);

  if (phone.unavailable) {
    return failed('unavailable', 'the phone system could not be read for this conversation', base);
  }
  if (phone.ambiguous) {
    return failed(
      'ambiguous',
      'too many outside numbers on this conversation to attribute one account',
      base, attribution,
    );
  }
  if (phone.numbers.length === 0) {
    return failed(
      'unmatched',
      'no customer-side number could be identified on this conversation',
      base, attribution,
    );
  }

  const contactIds = await resolveContactIds(phone.numbers.map((n) => n.digits));
  if (contactIds.length === 0) {
    return failed('unmatched', 'the customer number matches no CRM contact', base, attribution);
  }

  const identity = await loadAccountIdentity(contactIds);
  if (identity.unavailable) {
    return failed('unavailable', 'the CRM account lookup failed', base, attribution);
  }

  const rows = await findTaskCandidates({
    contactIds: identity.contactIds,
    leadIds: identity.leadIds,
    customerIds: identity.customerIds,
    notAfter,
  });
  if (rows === null) {
    return failed('unavailable', 'the CRM task lookup failed', base, attribution);
  }

  const selection = selectSalesRecords({
    rows,
    identity: {
      contactIds: identity.contactIds,
      leadIds: identity.leadIds,
      customerIds: identity.customerIds,
    },
    callAt: candidate.startedAt,
    callText,
  });

  let records = selection.records;
  let outcome = selection.outcome;
  let reason = selection.reason;
  let duplicatePath: string[] = [];
  let crossAccount = false;

  // A closed lead may be a duplicate whose opportunity moved elsewhere. Follow it
  // before concluding the account has no history — but never let a cross-account
  // successor keep a verified outcome.
  const primary = selection.primary;
  if (primary && primary.open !== 'open') {
    const startRow = rows.find((r) => Number(r.TaskID) === primary.taskId);
    if (startRow) {
      const trace = await traceDuplicateSuccessors(startRow, notAfter, identity.customerIds);
      duplicatePath = trace.path;
      // The stop reason is reported whether or not anything was found. "Duplicate
      // closed; successor not established" is the honest answer and has to reach
      // the prompt — silently reporting only "no open lead" invites the model to
      // read a dead-end duplicate as an account with no history.
      if (trace.path.length > 0) reason = `${reason}; ${trace.stopReason}`;
      if (trace.successors.length > 0) {
        records = mergeSuccessors(records, trace.successors, identity);
        // Only claimed when a cross-account record is actually IN the packet, so
        // the prompt's cross-account warning always describes something present.
        crossAccount = trace.crossAccount;
        if (crossAccount && outcome === 'verified') outcome = 'provisional';
      }
    }
  }

  if (records.length === 0) {
    return failed(
      outcome === 'ambiguous' ? 'ambiguous' : 'unmatched',
      reason,
      emptyResolution({ numbers, rejected: selection.rejected, duplicatePath }),
      attribution,
    );
  }

  const thread = await renderSalesThread({ records, callAt: candidate.startedAt, notAfter });
  const tickets = await loadTicketContext(identity, notAfter);

  const cited = records.find((r) => r.role === 'primary_sales') ?? null;
  const resolution: CrmResolutionSummary = {
    outcome,
    reason,
    primaryRef: cited ? crmRefToken('TASK', cited.taskId) : null,
    salesRefs: thread.refs,
    ticketRefs: tickets.refs,
    duplicatePath,
    rejected: selection.rejected,
    numbers,
    crossAccount,
  };

  logger.info(
    `[MISSED OPPS] ${candidate.conversationId} resolved ${outcome}: `
    + `${resolution.primaryRef ?? 'no primary'} — ${reason}`
    + (tickets.refs.length ? ` | tickets ${tickets.refs.join(', ')}` : '')
    + (selection.rejected.length ? ` | rejected ${selection.rejected.length}` : ''),
  );

  const coverage = {
    ...thread.coverage,
    errors: [...thread.coverage.errors, ...tickets.errors],
  };
  return {
    kind: cited ? 'TASK' : null,
    id: cited ? cited.taskId : null,
    outcome,
    attribution,
    crm: {
      notes: thread.notes,
      refs: [...thread.refs, ...tickets.refs],
      scope: 'record',
      recordLabel: cited ? recordLabelOf(cited) : undefined,
      resolution,
      coverage,
      ...(tickets.notes ? { ticketNotes: tickets.notes } : {}),
      ...(coverage.errors.length ? { unavailable: true } : {}),
      ...(coverage.truncated ? { truncated: true } : {}),
    },
  };
}

function recordLabelOf(record: SalesRecord): string {
  const parts = [record.taskType, record.accountName, record.open === 'open' ? 'open' : record.open]
    .filter(Boolean)
    .join(' / ');
  return `${crmRefToken('TASK', record.taskId)} — ${parts || 'sales record'}`;
}

/**
 * Add validated duplicate successors, keeping the duplicate itself as historical
 * provenance. An OPEN successor becomes the record the call is graded against;
 * the duplicate is demoted, never dropped, because it is where the prior
 * decisions were written.
 */
function mergeSuccessors(
  records: SalesRecord[],
  successors: Parameters<typeof toSalesRecord>[0][],
  identity: { contactIds: number[]; leadIds: number[]; customerIds: number[] },
): SalesRecord[] {
  const merged = [...records];
  let promoted: SalesRecord | null = null;
  for (const row of successors) {
    const record = toSalesRecord(row, identity);
    if (merged.some((r) => r.taskId === record.taskId)) continue;
    record.role = record.open === 'open' && !promoted ? 'primary_sales' : 'associated_lead';
    if (record.role === 'primary_sales') promoted = record;
    merged.push(record);
  }
  if (!promoted) return merged;
  for (const r of merged) {
    if (r !== promoted && r.role === 'primary_sales') r.role = 'historical_duplicate';
  }
  return [promoted, ...merged.filter((r) => r !== promoted)];
}

/** The account's most recent tickets, rendered as their own operational block. */
async function loadTicketContext(
  identity: { contactIds: number[]; customerIds: number[] },
  notAfter: string,
): Promise<{ notes: string; refs: string[]; errors: string[] }> {
  const rows = await findTicketCandidates(identity.contactIds, identity.customerIds, notAfter);
  if (rows === null) return { notes: '', refs: [], errors: ['ticket lookup failed'] };
  const ids = rows.slice(0, MAX_TICKETS).map((r) => Number(r.TicketID)).filter((n) => n > 0);
  if (ids.length === 0) return { notes: '', refs: [], errors: [] };
  const labels = new Map(
    rows.map((r) => [
      Number(r.TicketID),
      [r.accountName, r.assignedToName ? `assigned ${r.assignedToName}` : null]
        .filter(Boolean).join(' / '),
    ]),
  );
  return renderTicketContext(ids, notAfter, labels);
}
