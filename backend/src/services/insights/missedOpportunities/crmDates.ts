/**
 * CRM date semantics for the Missed Opportunities resolver.
 *
 * `tblTask.CompletedOn` and `tblAction.CompletedOn` are NOT NULL in the CRM. An
 * open task carries the sentinel `0001-01-01 00:00:00` (and older rows
 * `0000-00-00`), so `CompletedOn IS NULL` matches nothing and the resolver read
 * every task — fulfilled, cancelled, years closed — as open. Sentinel handling
 * already exists for ticket headers in `crmTicketHeader.toCrmDate`; this module
 * reuses it rather than re-deriving the rule, and adds the two distinctions the
 * resolver needs on top of it.
 *
 * OPEN IS A TRI-STATE, NOT A BOOLEAN. A value we could not parse is not the same
 * answer as a sentinel: the sentinel means "never completed", an unparseable
 * string means we do not know. Collapsing them to "open" is how a completed task
 * would be promoted back to the current sales record by a parsing failure, which
 * is precisely the wrong direction to fail in.
 *
 * SCHEDULED IS NOT COMPLETED. A `tblAction` row is created when a follow-up is
 * scheduled and completed when someone works it, so `COALESCE(CompletedOn,
 * CreatedOn)` cannot order the thread correctly here — with a non-null sentinel
 * it never falls through to CreatedOn at all, and where it does it dates
 * completed work to when it was scheduled. `crmEventTime` returns the instant
 * AND which column it came from, so a caller can keep a scheduled follow-up
 * visible as a future commitment instead of back-dating it into history.
 */
import { toCrmDate } from '../../crmTicketHeader';

export type CrmDateInput = Date | string | null | undefined;

/**
 * CRM sentinel dates as they arrive from the driver as raw strings, including
 * the `CAST(... AS CHAR)` form `0001-01-01 05:00:00` that JS reads as year 2001.
 */
const SENTINEL_RE = /^000[01]-/;

/** A real instant, or null for a sentinel / unparseable value. */
export function crmDate(value: CrmDateInput): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return toCrmDate(value.trim());
  return toCrmDate(value);
}

export type CrmCompletionState = 'open' | 'completed' | 'unknown';

/**
 * Whether a `CompletedOn` means the record is still open.
 *
 *   - unset / empty / sentinel -> 'open'      (never completed)
 *   - a real timestamp         -> 'completed'
 *   - present but unparseable  -> 'unknown'   (never treated as open)
 */
export function completionState(value: CrmDateInput): CrmCompletionState {
  if (value === null || value === undefined) return 'open';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return 'unknown';
    // A pre-1970 Date is the driver-parsed sentinel, not a real completion.
    return crmDate(value) ? 'completed' : 'open';
  }
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim();
  if (!trimmed) return 'open';
  if (SENTINEL_RE.test(trimmed)) return 'open';
  return crmDate(trimmed) ? 'completed' : 'unknown';
}

/** True only for a record we positively established is still open. */
export function isOpen(value: CrmDateInput): boolean {
  return completionState(value) === 'open';
}

export type CrmEventBasis = 'completed' | 'scheduled' | 'unknown';

export interface CrmEventTime {
  /** The instant to order and date this row by, or null when neither column parsed. */
  at: Date | null;
  /** Which column `at` came from, so a scheduled row is not reported as done. */
  basis: CrmEventBasis;
}

/**
 * When a task action actually happened, and whether it happened at all.
 *
 * A completed action is dated by its completion. An action still scheduled is
 * dated by its creation and marked `scheduled`, which is what lets the caller
 * render it as a commitment ("due Friday") rather than as work performed.
 */
export function crmEventTime(completedOn: CrmDateInput, createdOn: CrmDateInput): CrmEventTime {
  const state = completionState(completedOn);
  if (state === 'completed') {
    const at = crmDate(completedOn);
    if (at) return { at, basis: 'completed' };
  }
  const created = crmDate(createdOn);
  if (created) return { at: created, basis: state === 'completed' ? 'completed' : 'scheduled' };
  return { at: null, basis: 'unknown' };
}

/**
 * `YYYY-MM-DD HH:MM:SS` from local components, as the CRM compares timestamps.
 * Local on purpose per the project's date convention — `toISOString` would move
 * the boundary a day west of Greenwich and silently cut the evening's notes.
 */
export function toCrmTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Last instant of a call's local calendar day, as a CRM-comparable string. */
export function endOfCallDay(callStartedAt: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${callStartedAt.getFullYear()}-${p(callStartedAt.getMonth() + 1)}-`
    + `${p(callStartedAt.getDate())} 23:59:59`;
}

/** `YYYY-MM-DD HH:MM` for a note header, or null when the row has no usable date. */
export function formatCrmMoment(value: CrmDateInput): string | null {
  const d = crmDate(value);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `YYYY-MM-DD` for a due date, or null for a sentinel / missing value. */
export function formatCrmDay(value: CrmDateInput): string | null {
  const d = crmDate(value);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
