/**
 * Rendering a resolved record set into the block the model reads.
 *
 * BOUNDED AT THE REVIEWED DAY. History means what existed when the call happened;
 * a re-grade of a day three weeks ago must not read notes written since. The bound
 * is the END of the call's day rather than the call's timestamp because the
 * salesperson's own post-call note — the dated next step, the quote they logged —
 * is the evidence the follow-through rules turn on and it lands minutes after they
 * hang up. Which side of the call a note falls on is therefore rendered explicitly
 * rather than left for the model to infer.
 *
 * THREE TIME BUCKETS, NOT ONE PILE. `before the call` is what the salesperson knew
 * and what a prior-completion exception may cite. `same day, after the call` can
 * establish follow-through but cannot change what the transcript shows was said.
 * A later note is recovery, and must never be read as historical compliance.
 *
 * EVERY LINE CARRIES ITS SOURCE. Record ref, action id, author, result and due
 * date travel with the text, because "cite the exact note" is only enforceable if
 * the note has an id, and "another employee's note is not this salesperson's
 * action" is only checkable if the author is on the line.
 */
import { crmEventTime, endOfCallDay, formatCrmDay, formatCrmMoment } from './crmDates';
import { loadTaskActions, loadTicketNotes, splitNote, type ActionRow } from './crmNotes';
import type { SalesRecord } from './crmSelect';
import { crmRefToken, type CrmCoverage } from './types';

/** Trailing bound on how much note text one call's prompt may carry. */
export const MAX_THREAD_CHARS = 14000;

export type NoteBucket = 'before_call' | 'same_day_follow_through' | 'later_recovery';

export interface RenderedThread {
  /** The rendered sales history, grouped by bucket. */
  notes: string;
  /** Citation tokens for the records rendered, in first-seen order. */
  refs: string[];
  coverage: CrmCoverage;
}

function bucketOf(at: Date | null, callAt: Date): NoteBucket {
  if (!at) return 'before_call';
  if (at.getTime() <= callAt.getTime()) return 'before_call';
  return endOfCallDay(at) === endOfCallDay(callAt) ? 'same_day_follow_through' : 'later_recovery';
}

const BUCKET_LABEL: Record<NoteBucket, string> = {
  before_call: 'BEFORE THIS CALL (what the salesperson already had — a prior-completion exception must cite one of these)',
  same_day_follow_through: 'SAME DAY, AFTER THIS CALL (follow-through only — cannot change what was said on the call)',
  later_recovery: 'AFTER THE CALL DAY (recovery context only — never evidence about this call)',
};

interface Line {
  bucket: NoteBucket;
  at: number;
  text: string;
}

/**
 * One action as a prompt line. A row whose note is pure boilerplate still renders
 * when it carries a due date or a result, because a scheduled follow-up IS the
 * evidence the timeframe rules ask for.
 */
function renderAction(row: ActionRow, record: SalesRecord, callAt: Date): Line | null {
  const ref = crmRefToken('TASK', record.taskId);
  const { prefix, body } = splitNote(row.Note);
  const event = crmEventTime(row.completedOn, row.createdOn);
  const due = formatCrmDay(row.dueOn);
  const author = (event.basis === 'completed' ? row.completedByName : row.createdByName)
    ?? row.completedByName ?? row.createdByName;

  if (!body && !due && !row.actionResult) return null;

  const head = [
    ref,
    `action ${row.ActionID}`,
    formatCrmMoment(event.basis === 'completed' ? row.completedOn : row.createdOn) ?? 'date unknown',
    event.basis === 'scheduled' ? 'SCHEDULED, not completed' : null,
    author ? `by ${author}` : 'author unknown',
    record.role === 'account_cm' ? 'Contact Manager' : record.taskType,
    row.actionResult,
    due ? `next contact due ${due}` : null,
  ].filter(Boolean).join(' · ');

  const text = body
    ? `[${head}] ${prefix ? `(auto: ${prefix}) ` : ''}${body}`
    : `[${head}] ${prefix ? `(auto-status only: ${prefix})` : '(no note text)'}`;

  return { bucket: bucketOf(event.at, callAt), at: event.at?.getTime() ?? 0, text };
}

export interface RenderSalesThreadArgs {
  records: SalesRecord[];
  callAt: Date;
  /** History cutoff, `YYYY-MM-DD HH:MM:SS`. */
  notAfter: string;
}

/**
 * Read and render the whole sales grading record set.
 *
 * Coverage is returned alongside the text, not folded into it: the difference
 * between "this account has no prior warranty discussion" and "we did not read
 * all of it" is the difference between a finding and a guess.
 */
export async function renderSalesThread(args: RenderSalesThreadArgs): Promise<RenderedThread> {
  const refs: string[] = [];
  const perRecord: Line[][] = [];
  const errors: string[] = [];
  let retrieved = 0;
  let truncated = false;

  for (const record of args.records) {
    const ref = crmRefToken('TASK', record.taskId);
    if (!refs.includes(ref)) refs.push(ref);
    const load = await loadTaskActions(record.taskId, args.notAfter);
    retrieved += load.total;
    if (load.unavailable) {
      errors.push(`${ref}: history read failed`);
      continue;
    }
    if (load.truncated) truncated = true;
    const recordLines: Line[] = [];
    for (const row of load.rows) {
      const line = renderAction(row, record, args.callAt);
      if (line) recordLines.push(line);
    }
    perRecord.push(recordLines);
  }

  // Spend the character budget RECORD BY RECORD in priority order — `args.records`
  // is primary-first — and newest-within-each. Pooling every record's notes into
  // one global newest-first list let a chatty associated Contact Manager crowd
  // the primary opportunity's older-but-decisive documentation (a prior offer or
  // decline the exception rules turn on) out of the budget. The record the call
  // is actually about is covered before any associated context is spent on.
  const kept: Line[] = [];
  let chars = 0;
  let full = false;
  for (const recordLines of perRecord) {
    if (full) { if (recordLines.length) truncated = true; continue; }
    for (const line of [...recordLines].sort((a, b) => b.at - a.at)) {
      if (chars + line.text.length + 1 > MAX_THREAD_CHARS) { truncated = true; full = true; break; }
      kept.push(line);
      chars += line.text.length + 1;
    }
  }

  const blocks: string[] = [];
  for (const bucket of ['before_call', 'same_day_follow_through', 'later_recovery'] as NoteBucket[]) {
    const inBucket = kept.filter((l) => l.bucket === bucket).sort((a, b) => a.at - b.at);
    if (inBucket.length === 0) continue;
    blocks.push(`--- ${BUCKET_LABEL[bucket]} ---`);
    blocks.push(...inBucket.map((l) => l.text));
  }

  return {
    notes: blocks.join('\n'),
    refs,
    coverage: {
      recordsRead: refs,
      rowsRetrieved: retrieved,
      rowsRendered: kept.length,
      rowsOmitted: Math.max(0, retrieved - kept.length),
      cutoff: args.notAfter,
      truncated,
      errors,
    },
  };
}

/** Trailing bound on the separate ticket-context block. */
const MAX_TICKET_CHARS = 3000;

export interface RenderedTickets {
  notes: string;
  refs: string[];
  errors: string[];
}

/**
 * Support/billing/return tickets, rendered in their OWN block.
 *
 * Kept apart from the sales records on purpose: a ticket is operational truth and
 * the raw material for recovery planning, and an AE's note on a ticket is still a
 * ticket note. It cannot satisfy the lead/CM documentation an exception requires,
 * and the only way to keep that rule enforceable is to never mix the two blocks.
 */
export async function renderTicketContext(
  ticketIds: number[],
  notAfter: string,
  labels: Map<number, string> = new Map(),
): Promise<RenderedTickets> {
  const refs: string[] = [];
  const errors: string[] = [];
  const lines: Array<{ at: number; text: string }> = [];

  for (const ticketId of ticketIds) {
    const ref = crmRefToken('TICKET', ticketId);
    if (!refs.includes(ref)) refs.push(ref);
    const load = await loadTicketNotes(ticketId, notAfter, 60);
    if (load.unavailable) {
      errors.push(`${ref}: notes read failed`);
      continue;
    }
    for (const row of load.rows) {
      const { prefix, body } = splitNote(row.Note);
      if (!body) continue;
      const when = formatCrmMoment(row.createdOn);
      const head = [
        ref,
        `note ${row.TicketNoteID}`,
        when ?? 'date unknown',
        row.createdByName ? `by ${row.createdByName}` : 'author unknown',
        labels.get(ticketId) ?? null,
        row.noteTitle,
      ].filter(Boolean).join(' · ');
      lines.push({
        at: when ? new Date(when).getTime() : 0,
        text: `[${head}] ${prefix ? `(auto: ${prefix}) ` : ''}${body}`,
      });
    }
  }

  lines.sort((a, b) => b.at - a.at);
  const kept: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (chars + line.text.length + 1 > MAX_TICKET_CHARS) break;
    kept.push(line.text);
    chars += line.text.length + 1;
  }
  return { notes: kept.reverse().join('\n'), refs, errors };
}
