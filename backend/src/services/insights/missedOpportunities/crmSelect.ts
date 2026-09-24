/**
 * Which candidate record the reviewed call was actually about — pure selection,
 * no SQL, so every rule below is testable against a fixture.
 *
 * WHAT WENT WRONG BEFORE. Selection was "the single open lead, else the candidate
 * whose latest note is closest to the call", and a single candidate was labelled
 * `strong` on the strength of being the only one returned. Candidate count is not
 * identity: Lakeland and Keys each returned one task on an unrelated La Mesa
 * account and both were saved as confident links. So the rules here are:
 *
 *   - A LEAD NEEDS A REAL LEAD ID. `CustomerLeadID = 0` is "no lead", not a lead,
 *     and it must never join records together.
 *   - ACCOUNTS STAY SEPARATE. Candidates spanning two customers are not merged.
 *     Where the call independently corroborates one of them, the others are
 *     rejected with a reason; where it corroborates none, the answer is ambiguous.
 *   - PROXIMITY ONLY RANKS ALREADY-COMPATIBLE CANDIDATES. Several plausible open
 *     leads is a request for more evidence, not a licence to take the nearest
 *     note, so that case returns no primary and says so.
 *   - VERIFIED REQUIRES INDEPENDENT SUPPORT. A phone match alone is provisional;
 *     only a phone match the call itself corroborates by name is verified, and
 *     only a verified result may later override the model's own citation.
 */
import { completionState, crmDate } from './crmDates';
import { normalizeForMatch } from './evidence';
import type { TaskCandidateRow, TaskMatchPath } from './crmDiscover';
import type { ResolutionOutcome } from './types';

export type { ResolutionOutcome };

export type RecordRole = 'primary_sales' | 'associated_lead' | 'account_cm' | 'historical_duplicate';

export type OpenState = 'open' | 'closed' | 'unknown';

export interface SalesRecord {
  taskId: number;
  taskType: string | null;
  role: RecordRole;
  customerId: number | null;
  customerLeadId: number | null;
  accountName: string | null;
  /** Combined CompletedOn + status semantics; `unknown` is never treated as open. */
  open: OpenState;
  statusTitle: string | null;
  ownerName: string | null;
  dueOn: string | null;
  /** Latest action at or before the reviewed day's cutoff. */
  lastActionAt: Date | null;
  actionCount: number;
  matchedBy: TaskMatchPath[];
}

export interface RejectedCandidate {
  ref: string;
  reason: string;
}

export interface SalesRecordSelection {
  outcome: ResolutionOutcome;
  reason: string;
  primary: SalesRecord | null;
  /** The grading packet: primary first, then associated lead/CM history. */
  records: SalesRecord[];
  rejected: RejectedCandidate[];
  /** True when the call itself independently supports the chosen account. */
  corroborated: boolean;
}

/** Corporate-form and filler words that cannot distinguish one account from another. */
const GENERIC_TOKENS = new Set([
  'inc', 'llc', 'llp', 'ltd', 'corp', 'corporation', 'company', 'co', 'the', 'and', 'of', 'dba',
  'group', 'holdings', 'enterprises', 'enterprise', 'services', 'service', 'store', 'stores',
  'restaurant', 'restaurants', 'account', 'customer', 'test', 'new', 'old', 'site',
]);

/** A token short enough to collide by accident proves nothing about identity. */
const MIN_DISTINCTIVE_TOKEN = 5;

/**
 * Does the call itself support this being the right account?
 *
 * Name similarity can SUPPORT a phone match; it cannot establish one alone, which
 * is why the result only ever promotes an already-compatible candidate from
 * provisional to verified. A failure to corroborate is not a rejection — it keeps
 * the answer provisional, which is the honest outcome.
 */
export function corroboratesAccount(accountName: string | null, callText: string): boolean {
  const name = normalizeForMatch(accountName ?? '');
  if (!name) return false;
  const haystack = normalizeForMatch(callText);
  if (!haystack) return false;
  if (name.length >= MIN_DISTINCTIVE_TOKEN && haystack.includes(name)) return true;
  const distinctive = name
    .split(' ')
    .filter((t) => t.length >= MIN_DISTINCTIVE_TOKEN && !GENERIC_TOKENS.has(t));
  return distinctive.some((t) => haystack.includes(t));
}

/**
 * Whether the CRM says this task is still open.
 *
 * `CompletedOn` carries the `1-1-1` sentinel while open, and a source bug leaves
 * many finished tasks with no CompletedOn at all — so `tblTaskStatus.Closed` is
 * the authoritative terminal-status flag, with the one documented exception
 * ('Contact Past Due' is flagged closed yet is an actionable overdue contact).
 * Mirrors `workers/sql/task_open.extract.sql`.
 */
export function openStateOf(row: TaskCandidateRow): OpenState {
  const completion = completionState(row.completedOn);
  if (completion === 'completed') return 'closed';
  if (completion === 'unknown') return 'unknown';
  const closed = closedFlag(row.statusClosed);
  if (closed == null) return 'unknown';
  if (closed === 0) return 'open';
  return (row.statusTitle ?? '').trim().toLowerCase() === 'contact past due' ? 'open' : 'closed';
}

/**
 * `tblTaskStatus.Closed` normalized to 0, 1, or null. The query already casts it
 * to an integer, but the mysql2 driver returns a raw BIT column as a Buffer
 * (`<Buffer 00>` / `<Buffer 01>`) and `Number(Buffer)` is `NaN` — so any path
 * that reaches this flag without the SQL cast must still be read by its byte, not
 * coerced numerically. Everything unparseable is null, never silently open.
 */
export function closedFlag(raw: unknown): 0 | 1 | null {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (Buffer.isBuffer(raw)) return raw.length === 0 ? null : raw[0] === 0 ? 0 : 1;
  if (typeof raw === 'number') return Number.isFinite(raw) ? (raw === 0 ? 0 : 1) : null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? (n === 0 ? 0 : 1) : null;
  }
  return null;
}

const isLeadTask = (row: TaskCandidateRow) => Number(row.TaskTypeID) === 11;
const isContactManager = (row: TaskCandidateRow) =>
  (row.taskType ?? '').trim().toLowerCase() === 'contact manager';

/** Accounts are keyed by customer, or by the lead itself while unconverted. */
function accountKeyOf(row: TaskCandidateRow): string {
  const customerId = Number(row.CustomerID);
  if (Number.isFinite(customerId) && customerId > 0) return `C${customerId}`;
  const leadId = Number(row.CustomerLeadID);
  if (Number.isFinite(leadId) && leadId > 0) return `L${leadId}`;
  return `T${row.TaskID}`;
}

function matchPathsOf(row: TaskCandidateRow, identity: SelectArgs['identity']): TaskMatchPath[] {
  const paths: TaskMatchPath[] = [];
  const contactId = Number(row.ContactID);
  const leadId = Number(row.CustomerLeadID);
  const customerId = Number(row.CustomerID);
  if (contactId > 0 && identity.contactIds.includes(contactId)) paths.push('contact');
  if (leadId > 0 && identity.leadIds.includes(leadId)) paths.push('lead');
  if (customerId > 0 && identity.customerIds.includes(customerId)) paths.push('customer');
  return paths;
}

/**
 * A candidate row as a grading record. Exported so a successor reached by
 * following a duplicate note lands in exactly the same shape, and therefore under
 * exactly the same open-state and relationship rules, as a phone-discovered one.
 */
export function toSalesRecord(row: TaskCandidateRow, identity: SelectArgs['identity']): SalesRecord {
  const leadId = Number(row.CustomerLeadID);
  const customerId = Number(row.CustomerID);
  return {
    taskId: Number(row.TaskID),
    taskType: row.taskType,
    role: 'associated_lead',
    customerId: Number.isFinite(customerId) && customerId > 0 ? customerId : null,
    customerLeadId: Number.isFinite(leadId) && leadId > 0 ? leadId : null,
    accountName: row.accountName?.trim() || null,
    open: openStateOf(row),
    statusTitle: row.statusTitle?.trim() || null,
    ownerName: row.ownerName?.trim() || null,
    dueOn: row.dueOn ?? null,
    lastActionAt: crmDate(row.lastActionOn),
    actionCount: Number(row.actionCount) || 0,
    matchedBy: matchPathsOf(row, identity),
  };
}

export interface SelectArgs {
  rows: TaskCandidateRow[];
  identity: { contactIds: number[]; leadIds: number[]; customerIds: number[] };
  /** When the reviewed call started, for same-day opportunity evidence. */
  callAt: Date;
  /** Transcript plus phone label — the independent corroboration source. */
  callText: string;
}

/** Same local calendar day, which is the only proximity signal we trust. */
function sameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Choose the sales grading record set for one call.
 *
 * Returns every record in the chosen account (primary first) so the note loader
 * can read the lead AND the account CM, and returns the rejects with reasons so a
 * wrong link is diagnosable instead of invisible.
 */
export function selectSalesRecords(args: SelectArgs): SalesRecordSelection {
  const rejected: RejectedCandidate[] = [];
  const usable: TaskCandidateRow[] = [];

  for (const row of args.rows) {
    const ref = `TASK ${row.TaskID}`;
    if (isLeadTask(row) && !(Number(row.CustomerLeadID) > 0)) {
      rejected.push({ ref, reason: 'lead-type task with no real CustomerLeadID' });
      continue;
    }
    if (!isLeadTask(row) && !isContactManager(row)) {
      rejected.push({ ref, reason: `task type "${row.taskType ?? 'unknown'}" is not sales work` });
      continue;
    }
    if (matchPathsOf(row, args.identity).length === 0) {
      rejected.push({ ref, reason: 'no verified contact/lead/customer relationship' });
      continue;
    }
    usable.push(row);
  }

  if (usable.length === 0) {
    return {
      outcome: 'unmatched',
      reason: 'no Lead Manager or Contact Manager task on a verified account',
      primary: null, records: [], rejected, corroborated: false,
    };
  }

  // Group by account and keep them separate. A shared phone, brand or owner is
  // not evidence that two customers are one account.
  const byAccount = new Map<string, TaskCandidateRow[]>();
  for (const row of usable) {
    const key = accountKeyOf(row);
    const list = byAccount.get(key);
    if (list) list.push(row);
    else byAccount.set(key, [row]);
  }

  const accounts = [...byAccount.entries()].map(([key, rows]) => ({
    key,
    rows,
    corroborated: rows.some((r) => corroboratesAccount(r.accountName, args.callText)),
  }));

  let chosen = accounts[0];
  let corroborated = accounts[0].corroborated;
  if (accounts.length > 1) {
    const supported = accounts.filter((a) => a.corroborated);
    if (supported.length !== 1) {
      for (const a of accounts) {
        for (const r of a.rows) {
          rejected.push({
            ref: `TASK ${r.TaskID}`,
            reason: supported.length === 0
              ? 'several candidate accounts and the call corroborates none'
              : 'several candidate accounts and the call corroborates more than one',
          });
        }
      }
      return {
        outcome: 'ambiguous',
        reason: `${accounts.length} candidate accounts could not be separated by the call's own evidence`,
        primary: null, records: [], rejected, corroborated: false,
      };
    }
    chosen = supported[0];
    corroborated = true;
    for (const a of accounts) {
      if (a.key === chosen.key) continue;
      for (const r of a.rows) {
        rejected.push({ ref: `TASK ${r.TaskID}`, reason: 'different account; the call names another' });
      }
    }
  }

  const records = chosen.rows.map((r) => toSalesRecord(r, args.identity));
  for (const rec of records) if (isCm(rec)) rec.role = 'account_cm';

  const leads = records.filter((r) => !isCm(r));
  const openLeads = leads.filter((r) => r.open === 'open');

  let primary: SalesRecord | null = null;
  let outcome: ResolutionOutcome = 'provisional';
  let reason: string;
  // Whether the primary is a positively OPEN opportunity, as opposed to a
  // historical closed lead or the account's Contact Manager standing in for one.
  // This is the account-vs-opportunity distinction: a name match proves the
  // account, not that a fulfilled or historical record is the transaction being
  // graded, so only an open opportunity may be promoted past provisional.
  let opportunityOpen = false;

  if (openLeads.length === 1) {
    primary = openLeads[0];
    opportunityOpen = true;
    reason = 'one open lead on the verified account';
  } else if (openLeads.length > 1) {
    // Same-day activity is the only opportunity evidence we can establish
    // deterministically. Without it, several open leads stay ambiguous rather
    // than resolving to whichever note sits nearest the call.
    const sameDayLeads = openLeads.filter((r) => sameDay(r.lastActionAt, args.callAt));
    if (sameDayLeads.length === 1) {
      primary = sameDayLeads[0];
      opportunityOpen = true;
      reason = 'one of several open leads was worked on the reviewed day';
    } else {
      outcome = 'ambiguous';
      reason = `${openLeads.length} open leads on this account and no same-opportunity evidence to choose between them`;
    }
  } else {
    // No open lead. Before falling back to a closed lead, prefer an OPEN Contact
    // Manager that is the live account record: for an existing customer the active
    // sales history lives on the CM, while a closed lead is often a same-day
    // fulfilment stub with no opportunity on it (this is what cited an empty
    // 2-action stub over the 38-action open CM that held the real account work).
    // Gated on the CM being worked at least as recently as the newest closed lead,
    // so a stale CM never displaces a genuine recent lead. A CM still cannot be a
    // resolved opportunity, so `opportunityOpen` stays false and the outcome is
    // provisional exactly as the closed-lead fallback is.
    const liveCm = records
      .filter((r) => isCm(r) && r.open === 'open')
      .sort(byRecency)[0] ?? null;
    const recentLead = [...leads].sort(byRecency)[0] ?? null;
    const cmAtLeastAsRecent = !!liveCm
      && (liveCm.lastActionAt?.getTime() ?? -Infinity)
        >= (recentLead?.lastActionAt?.getTime() ?? -Infinity);

    if (liveCm && cmAtLeastAsRecent) {
      primary = liveCm;
      reason = 'no open lead; the account Contact Manager is the sales record';
    } else if (recentLead) {
      // The sale is fulfilled or the lead is closed. Use the real closed lead as
      // the historical record rather than inventing an open one — but this is a
      // historical record, not a resolved current opportunity.
      primary = recentLead;
      reason = recentLead.open === 'unknown'
        ? 'no open lead; most recently worked lead used, open state could not be established'
        : 'no open lead; most recently worked closed lead used as the historical record';
    } else {
      const cm = records.find(isCm) ?? null;
      primary = cm;
      reason = cm
        ? 'no lead on this account; the account Contact Manager is the sales record'
        : 'no lead or Contact Manager could be selected';
    }
  }

  if (primary) {
    primary.role = 'primary_sales';
    // Verified needs the phone match, the call's own corroboration AND an open
    // opportunity to attach it to. A historical closed lead or a fall-back CM
    // stays provisional however well the account name matches — promoting either
    // to verified is exactly what let a fulfilled or unrelated record overwrite
    // the model's citation.
    if (outcome !== 'ambiguous') {
      outcome = opportunityOpen && corroborated ? 'verified' : 'provisional';
    }
  } else if (outcome !== 'ambiguous') {
    outcome = 'unmatched';
  }

  const ordered = primary ? [primary, ...records.filter((r) => r !== primary)] : records;
  return { outcome, reason, primary, records: ordered, rejected, corroborated };
}

const isCm = (r: SalesRecord) => (r.taskType ?? '').trim().toLowerCase() === 'contact manager';

/** Most recently worked first; a record with no readable activity sorts last. */
function byRecency(a: SalesRecord, b: SalesRecord): number {
  const at = a.lastActionAt?.getTime() ?? -Infinity;
  const bt = b.lastActionAt?.getTime() ?? -Infinity;
  return bt - at;
}
