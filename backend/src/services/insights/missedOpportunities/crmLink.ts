/**
 * Resolve the CRM work item behind a sales call, from the call's phone number.
 *
 * WHY THIS EXISTS. The analyzer starts from Genesys conversations, but Genesys
 * carries no TaskID/TicketID and the CRM carries no ConversationID (the gap
 * CallTicketLinkerService documents). So `crmActivity.ts` could only give the
 * model the agent's WHOLE DAY of notes matched by name — never the specific
 * account's history. Without that history you cannot tell a genuine miss from a
 * step the rep already completed on a prior call. This module closes that gap:
 * it takes the call's far-end number, finds the account's Lead Manager or
 * Contact Manager task (where the research actually lives — not the Contact
 * Update stub), and returns that record's note thread plus a deep-linkable ref.
 *
 * BRIDGE, NOT FINAL. A phone number can sit on several accounts. Per product
 * direction we narrow with these rules and accept a best-effort match rather
 * than nothing:
 *   1. a single OPEN lead-task on the matched account  -> 'strong'
 *   2. otherwise the candidate whose latest note is closest to the call time,
 *      used to validate which record the call was about -> 'weak'
 *   3. nothing resolvable -> null, and the finding simply notes it could not be
 *      verified. (A per-call CRM linkage is planned; this holds the line until.)
 *
 * Every query degrades to empty on failure so a CRM hiccup costs the call its
 * history (falling back to the day-wide notes), never the whole run.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import logger from '../../../config/logger';
import { CallCandidate, CrmDayActivity, CrmRefKind } from './types';
import { endOfCallDay, loadSalesThreads, loadThread, type SalesTaskRow } from './crmLinkThread';

/** Too many contacts on one number to trust even the open-lead narrowing. */
const MAX_CONTACTS = 25;

export type LinkConfidence = 'strong' | 'weak';

export interface ResolvedCrmRecord {
  kind: CrmRefKind;
  id: number;
  confidence: LinkConfidence;
  /** The record's note thread, scoped for the prompt. */
  crm: CrmDayActivity;
}

/** Digits-only last-10 for every distinct far-end number on the conversation. */
export async function getFarEndNumbers(conversationId: string): Promise<string[]> {
  try {
    const rows = await executeQuery<{ ANI: string | null; Dnis: string | null; Remote: string | null }>(
      'SELECT DISTINCT ANI, Dnis, Remote FROM tblSessions WHERE ConversationID = ?',
      [conversationId],
      'phone',
    );
    const set = new Set<string>();
    for (const r of rows) {
      for (const raw of [r.ANI, r.Dnis, r.Remote]) {
        const digits = String(raw ?? '').replace(/[^0-9]/g, '');
        if (digits.length >= 10) set.add(digits.slice(-10));
      }
    }
    return [...set];
  } catch (err) {
    logger.warn(`[MISSED OPPS] far-end lookup failed for ${conversationId}: ${(err as Error).message}`);
    return [];
  }
}

const inList = (n: number) => Array.from({ length: n }, () => '?').join(',');

// The CRM runs an older MySQL/MariaDB with no REGEXP_REPLACE, so strip the
// common phone separators with nested REPLACE (same approach as
// CallTicketLinkerService) and compare the last 10 digits.
const digits = (col: string) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')`;

/** Contacts whose Phone1/Phone2 last-10 matches any of the call's numbers. */
export async function resolveContactIds(numbers: string[]): Promise<number[]> {
  if (numbers.length === 0) return [];
  const ph = inList(numbers.length);
  try {
    const rows = await executeQuery<{ ContactID: number }>(
      `SELECT DISTINCT ContactID FROM tblContactPhone
        WHERE RIGHT(${digits('Phone1')}, 10) IN (${ph})
           OR RIGHT(${digits('Phone2')}, 10) IN (${ph})`,
      [...numbers, ...numbers],
      'crm',
    );
    return rows.map((r) => Number(r.ContactID)).filter((n) => Number.isFinite(n));
  } catch (err) {
    logger.warn(`[MISSED OPPS] contact lookup failed: ${(err as Error).message}`);
    return [];
  }
}

type TaskRow = SalesTaskRow;

/**
 * Sales work lives on the lead-task (TaskTypeID 11, "Lead Manager") and on
 * Contact Manager. Contact Update Manager and other types are bookkeeping
 * stubs — linking those is why the model kept grading against an empty
 * "Created Contact Update Manager Task" line instead of the research already
 * on the lead.
 */
const SALES_TASK_SQL =
  `(t.TaskTypeID = 11 OR tt.Title = 'Contact Manager')`;

/** Candidate tasks (incl. lead-tasks) tied to the matched contacts or their leads. */
async function findTasks(contactIds: number[], leadIds: number[]): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: number[] = [];
  if (contactIds.length) { where.push(`t.ContactID IN (${inList(contactIds.length)})`); params.push(...contactIds); }
  if (leadIds.length) { where.push(`t.CustomerLeadID IN (${inList(leadIds.length)})`); params.push(...leadIds); }
  if (where.length === 0) return [];
  try {
    return await executeQuery<TaskRow>(
      `SELECT t.TaskID, t.CustomerLeadID, t.CompletedOn,
              tt.Title AS taskType,
              COALESCE(cu.Name, cl.Name) AS accountName,
              MAX(COALESCE(a.CompletedOn, a.CreatedOn)) AS lastActionOn
         FROM tblTask t
         LEFT JOIN tblTaskType     tt ON tt.TaskTypeID = t.TaskTypeID
         LEFT JOIN tblAction       a  ON a.TaskID = t.TaskID
         LEFT JOIN tblCustomers    cu ON cu.CustomerID = t.CustomerID
         LEFT JOIN tblCustomerLead cl ON cl.CustomerLeadID = t.CustomerLeadID
        WHERE (${where.join(' OR ')})
          AND ${SALES_TASK_SQL}
        GROUP BY t.TaskID, t.CustomerLeadID, t.CompletedOn, tt.Title, accountName
        ORDER BY lastActionOn DESC
        LIMIT 50`,
      params,
      'crm',
    );
  } catch (err) {
    logger.warn(`[MISSED OPPS] task lookup failed: ${(err as Error).message}`);
    return [];
  }
}

interface TicketRow {
  TicketID: number;
  accountName: string | null;
  at: Date | string | null;
}

/** Candidate tickets on the matched contacts or their customers. */
async function findTickets(contactIds: number[], customerIds: number[]): Promise<TicketRow[]> {
  const where: string[] = [];
  const params: number[] = [];
  if (contactIds.length) { where.push(`ti.ContactID IN (${inList(contactIds.length)})`); params.push(...contactIds); }
  if (customerIds.length) { where.push(`ti.CustomerID IN (${inList(customerIds.length)})`); params.push(...customerIds); }
  if (where.length === 0) return [];
  try {
    return await executeQuery<TicketRow>(
      `SELECT ti.TicketID, cu.Name AS accountName,
              COALESCE(ti.ModifiedOn, ti.CreatedOn) AS at
         FROM tblTicket ti
         LEFT JOIN tblCustomers cu ON cu.CustomerID = ti.CustomerID
        WHERE ${where.join(' OR ')}
        ORDER BY at DESC
        LIMIT 50`,
      params,
      'crm',
    );
  } catch (err) {
    logger.warn(`[MISSED OPPS] ticket lookup failed: ${(err as Error).message}`);
    return [];
  }
}

const ms = (v: Date | string | null): number | null => {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Closest-by-note-time ranker: smaller time delta to the call wins; nulls last. */
function pickClosest<T extends { at: number | null }>(rows: T[], callMs: number): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const da = a.at == null ? Infinity : Math.abs(a.at - callMs);
    const db = b.at == null ? Infinity : Math.abs(b.at - callMs);
    return da - db;
  })[0];
}

/**
 * Resolve the one task/ticket a call was about, with its note history. Returns
 * null when the number maps to no record or is too ambiguous to trust — the
 * caller then falls back to the agent's day-wide notes.
 */
export async function resolveCallCrmRecord(candidate: CallCandidate): Promise<ResolvedCrmRecord | null> {
  const numbers = await getFarEndNumbers(candidate.conversationId);
  if (numbers.length === 0) return null;

  const contactIds = await resolveContactIds(numbers);
  if (contactIds.length === 0 || contactIds.length > MAX_CONTACTS) return null;

  // Leads + customers behind those contacts, for the task/ticket joins.
  let leadIds: number[] = [];
  let customerIds: number[] = [];
  try {
    const leads = await executeQuery<{ CustomerLeadID: number; CustomerID: number | null }>(
      `SELECT CustomerLeadID, CustomerID FROM tblCustomerLead WHERE ContactID IN (${inList(contactIds.length)})`,
      contactIds, 'crm',
    );
    leadIds = leads.map((l) => Number(l.CustomerLeadID)).filter(Number.isFinite);
    const contacts = await executeQuery<{ CustomerID: number | null }>(
      `SELECT DISTINCT CustomerID FROM tblContacts WHERE ContactID IN (${inList(contactIds.length)})`,
      contactIds, 'crm',
    );
    customerIds = [...leads, ...contacts]
      .map((c) => Number(c.CustomerID)).filter((n) => Number.isFinite(n) && n > 0);
  } catch (err) {
    logger.warn(`[MISSED OPPS] lead/customer lookup failed: ${(err as Error).message}`);
  }

  const callMs = candidate.startedAt.getTime();
  // Notes written after the call's day are not history this call could have
  // had. See crmLinkThread.endOfCallDay for why the bound is end-of-day.
  const notAfter = endOfCallDay(candidate.startedAt);

  // Tasks first — sales work is task/lead-centric. Prefer a single open
  // lead-task; otherwise narrow the field by the note closest to the call.
  const tasks = await findTasks(contactIds, leadIds);
  if (tasks.length > 0) {
    const openLead = tasks.filter((t) => t.CustomerLeadID != null && t.CompletedOn == null);
    const base = openLead.length > 0 ? openLead : tasks;
    const ranked = base.map((t) => ({ ...t, at: ms(t.lastActionOn) }));
    const best = pickClosest(ranked, callMs);
    if (best) {
      const confidence: LinkConfidence = base.length === 1 ? 'strong' : 'weak';
      const { cited, crm } = await loadSalesThreads(best, tasks, notAfter);
      return { kind: 'TASK', id: cited, confidence, crm: { ...crm, matchConfidence: confidence } };
    }
  }

  const tickets = await findTickets(contactIds, customerIds);
  const rankedTickets = tickets.map((t) => ({ ...t, at: ms(t.at) }));
  const bestTicket = pickClosest(rankedTickets, callMs);
  if (bestTicket) {
    const confidence: LinkConfidence = tickets.length === 1 ? 'strong' : 'weak';
    const label = `TICKET ${bestTicket.TicketID} — ${bestTicket.accountName ?? 'customer'}`;
    return {
      kind: 'TICKET',
      id: bestTicket.TicketID,
      confidence,
      crm: { ...await loadThread('TICKET', bestTicket.TicketID, label, notAfter), matchConfidence: confidence },
    };
  }

  return null;
}
