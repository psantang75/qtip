/**
 * Duplicate-closed lead traversal.
 *
 * A closed lead is not automatically the end of the story: the CRM's working
 * practice is to close a lead as a duplicate and carry the opportunity onto
 * another lead, or onto the account's Contact Manager, sometimes under a
 * different CustomerID. Grading against the duplicate reads as an account with no
 * history at all, which is how a real prior decision — the warranty already
 * offered, the site count already scoped — disappears.
 *
 * NOTES ARE DATA, NOT INSTRUCTIONS. A reference extracted from a note is a
 * candidate id and nothing more: it is looked up, its type and account checked,
 * and discarded when it does not validate. No URL is ever fetched, and text in a
 * note cannot direct the review.
 *
 * DUPLICATE IS NOT FULFILLED. "Task closed because a new lead was created" is
 * system/fulfilment bookkeeping, not a duplicate merge; following it as one would
 * invent a successor relationship the CRM never asserted. The two are classified
 * separately and only a duplicate is traversed.
 *
 * A CROSS-ACCOUNT REFERENCE EXPANDS, IT DOES NOT MERGE. Where a note points at
 * another CustomerID the records there are returned as historical provenance with
 * their own identity intact; the caller may never promote such a result to
 * verified, because a dealer's Contact Manager is not the customer's direct-sales
 * lead.
 */
import logger from '../../../config/logger';
import { findTaskCandidates, findTasksByIds, type TaskCandidateRow } from './crmDiscover';
import { loadTaskActions } from './crmNotes';
import { openStateOf } from './crmSelect';

/** How many duplicate hops to follow before giving up. */
const MAX_DEPTH = 3;
/** Notes read per hop looking for the closure reason. */
const CLOSURE_NOTE_ROWS = 40;

const DUPLICATE_RE = /\b(?:duplicate|dupe|duplicated|merged\s+in?to)\b/i;
const FULFILLED_RE =
  /\b(?:closed because a new lead was created|order released|converted to (?:an )?order|closed by (?:the )?system|no active services)\b/i;

/**
 * Typed references a note may carry. Longer keywords come first so "customer
 * lead 193194" is read as a lead rather than as a customer.
 */
const REFERENCE_RE =
  /\b(customer\s*lead|contact\s*manager|task|lead|customer|cm)\s*(?:id)?\s*(?:#|:|=)?\s*(\d{3,10})\b/gi;

type RefKind = 'task' | 'lead' | 'customer';

export interface ExtractedRef {
  kind: RefKind;
  id: number;
}

/** Pull typed record references out of one note's raw text. */
export function extractReferences(text: string): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(REFERENCE_RE)) {
    const word = m[1].toLowerCase().replace(/\s+/g, ' ');
    const id = Number(m[2]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const kind: RefKind = word === 'customer lead' || word === 'lead'
      ? 'lead'
      : word === 'customer'
        ? 'customer'
        : 'task';
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
  }
  return out;
}

export type ClosureKind = 'duplicate' | 'fulfilled_or_system' | 'unknown';

export interface ClosureRead {
  kind: ClosureKind;
  /** Action id of the note the classification came from, for citation. */
  actionId: number | null;
  refs: ExtractedRef[];
}

/** Classify why a task closed, from its own notes. */
export function classifyClosure(
  notes: Array<{ ActionID: number; Note: string | null }>,
): ClosureRead {
  let fulfilled: ClosureRead | null = null;
  for (const n of notes) {
    const text = n.Note ?? '';
    if (!text.trim()) continue;
    if (DUPLICATE_RE.test(text)) {
      return { kind: 'duplicate', actionId: Number(n.ActionID) || null, refs: extractReferences(text) };
    }
    if (!fulfilled && FULFILLED_RE.test(text)) {
      fulfilled = { kind: 'fulfilled_or_system', actionId: Number(n.ActionID) || null, refs: [] };
    }
  }
  return fulfilled ?? { kind: 'unknown', actionId: null, refs: [] };
}

export interface DuplicateTrace {
  /** Ordered account of what was followed and why it stopped. */
  path: string[];
  /** Validated successor records, in the order they were reached. */
  successors: TaskCandidateRow[];
  /** Customers the trace legitimately expanded into (never merged silently). */
  expandedCustomerIds: number[];
  /** True when a successor sits on a customer the phone match did not establish. */
  crossAccount: boolean;
  stopReason: string;
}

/** Validate one note reference into real task rows. */
async function resolveRef(ref: ExtractedRef, notAfter: string): Promise<TaskCandidateRow[]> {
  if (ref.kind === 'task') return (await findTasksByIds([ref.id], notAfter)) ?? [];
  if (ref.kind === 'lead') {
    return (await findTaskCandidates({
      contactIds: [], leadIds: [ref.id], customerIds: [], notAfter,
    })) ?? [];
  }
  return (await findTaskCandidates({
    contactIds: [], leadIds: [], customerIds: [ref.id], notAfter,
  })) ?? [];
}

/** An open lead is the best successor; then any lead; then the account CM. */
function pickSuccessor(rows: TaskCandidateRow[]): TaskCandidateRow | null {
  const leads = rows.filter((r) => Number(r.TaskTypeID) === 11 && Number(r.CustomerLeadID) > 0);
  const open = leads.find((r) => openStateOf(r) === 'open');
  if (open) return open;
  if (leads.length > 0) return leads[0];
  return rows.find((r) => (r.taskType ?? '').trim().toLowerCase() === 'contact manager') ?? null;
}

/**
 * Follow a duplicate-closed lead to the record that carries the opportunity now.
 *
 * Bounded, cycle-safe, and explicit about failure: "duplicate closed; successor
 * not established" is a legitimate answer and a far better one than attaching the
 * call to whichever record the note happened to mention.
 */
export async function traceDuplicateSuccessors(
  start: TaskCandidateRow,
  notAfter: string,
  knownCustomerIds: readonly number[],
): Promise<DuplicateTrace> {
  const path: string[] = [];
  const successors: TaskCandidateRow[] = [];
  const expanded = new Set<number>();
  const visited = new Set<number>([Number(start.TaskID)]);
  let current = start;
  let stopReason = 'no duplicate closure found';

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const load = await loadTaskActions(Number(current.TaskID), notAfter, CLOSURE_NOTE_ROWS);
    if (load.unavailable) {
      stopReason = `notes unavailable on TASK ${current.TaskID}`;
      path.push(stopReason);
      break;
    }
    const closure = classifyClosure(load.rows);
    if (closure.kind !== 'duplicate') {
      stopReason = closure.kind === 'fulfilled_or_system'
        ? `TASK ${current.TaskID} closed by fulfilment/system, not as a duplicate`
        : `TASK ${current.TaskID} shows no duplicate closure`;
      path.push(stopReason);
      break;
    }

    path.push(
      `TASK ${current.TaskID} duplicate-closed`
      + (closure.actionId ? ` (action ${closure.actionId})` : '')
      + `; refs: ${closure.refs.map((r) => `${r.kind} ${r.id}`).join(', ') || 'none'}`,
    );
    if (closure.refs.length === 0) {
      stopReason = 'duplicate closed; successor not established';
      break;
    }

    let next: TaskCandidateRow | null = null;
    for (const ref of closure.refs) {
      const rows = await resolveRef(ref, notAfter);
      if (rows.length === 0) {
        path.push(`${ref.kind} ${ref.id} did not validate`);
        continue;
      }
      if (ref.kind === 'customer') expanded.add(ref.id);
      const picked = pickSuccessor(rows);
      if (!picked) {
        path.push(`${ref.kind} ${ref.id} has no lead or Contact Manager`);
        continue;
      }
      if (visited.has(Number(picked.TaskID))) {
        path.push(`TASK ${picked.TaskID} already visited — cycle stopped`);
        continue;
      }
      next = picked;
      break;
    }

    if (!next) {
      stopReason = 'duplicate closed; successor not established';
      break;
    }
    visited.add(Number(next.TaskID));
    successors.push(next);
    const customerId = Number(next.CustomerID);
    if (customerId > 0 && !knownCustomerIds.includes(customerId)) expanded.add(customerId);
    path.push(`-> TASK ${next.TaskID} (${next.taskType ?? 'task'}, ${openStateOf(next)})`);

    if (openStateOf(next) === 'open') {
      stopReason = `open successor TASK ${next.TaskID}`;
      break;
    }
    current = next;
    stopReason = `followed to TASK ${next.TaskID}`;
  }

  if (path.length > 0) {
    logger.info(`[MISSED OPPS] duplicate trace from TASK ${start.TaskID}: ${path.join(' | ')}`);
  }
  return {
    path,
    successors,
    expandedCustomerIds: [...expanded],
    crossAccount: [...expanded].some((id) => !knownCustomerIds.includes(id)),
    stopReason,
  };
}
