/**
 * Pure date + scope helpers for scheduling. No DB, no Prisma — everything here
 * is deterministic and unit-tested directly, which is where the 1-vs-14 and
 * Sunday-vs-Monday mistakes get caught rather than in production data.
 *
 * The business week runs SUNDAY (getDay() === 0) to Saturday. A single
 * startOfWeek owns that boundary; no call site may re-derive it.
 *
 * All dates are 'YYYY-MM-DD' local-component strings, never Date instants, per
 * .cursor/rules/date-handling.mdc.
 */

/** Format a Date to 'YYYY-MM-DD' using LOCAL components. */
export function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse 'YYYY-MM-DD' to a local-midnight Date. */
export function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Day of week for a date string. 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(dateStr: string): number {
  return parseLocal(dateStr).getDay();
}

/** Add n days to a date string, returning a date string. */
export function addDays(dateStr: string, n: number): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + n);
  return fmtLocal(d);
}

/** The Sunday that begins the week containing dateStr. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -dayOfWeek(dateStr));
}

/** The seven date strings of the week beginning at a Sunday. */
export function weekDates(weekStart: string): string[] {
  const start = startOfWeek(weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type ApplyScope = 'day' | 'week' | 'period';
export type CalendarView = 'day' | 'week' | 'period';

/**
 * Resolve the concrete target dates of an apply/copy. Returns exactly 1, 7, or
 * 14 Sunday-aligned date strings. `day` scope is only meaningful from the day
 * view — from week/period there is no single day the phrase could mean, so it
 * is rejected.
 */
export function resolveApplyDates(
  view: CalendarView,
  scope: ApplyScope,
  day: string,
  anchor: string,
): string[] {
  if (scope === 'day') {
    if (view !== 'day') throw new Error('Day scope is only available from the day view');
    return [day];
  }
  const start = startOfWeek(anchor);
  if (scope === 'week') return weekDates(start);
  return [...weekDates(start), ...weekDates(addDays(start, 7))];
}

/**
 * The source date that maps onto a target date when copying one week onto
 * another. Weekday is preserved: the target's Monday pulls from the source
 * week's Monday, for all scopes, and a two-week target repeats the source week
 * rather than reaching back fourteen days.
 */
export function sourceDateFor(targetDate: string, sourceWeekStart: string): string {
  return addDays(startOfWeek(sourceWeekStart), dayOfWeek(targetDate));
}

/** A date is elapsed once it is strictly before today (same-day edits allowed). */
export function isElapsed(dateStr: string, today: string): boolean {
  return dateStr < today;
}

/**
 * A shift is locked when it is PUBLISHED and elapsed. A draft elapsed day stays
 * editable precisely so it can be corrected and published late.
 */
export function isShiftLocked(dateStr: string, status: string, today: string): boolean {
  return status === 'PUBLISHED' && isElapsed(dateStr, today);
}

export type RangeStatus = 'empty' | 'draft' | 'mixed' | 'published' | 'locked';

/**
 * Publish state of a date range across a set of shifts, deciding whether bulk
 * SCHEDULE writes are offered. Bulk exception writes are deliberately NOT gated
 * on this — see the exception service.
 */
export function rangeStatus(
  shifts: Array<{ shift_date: string; status: string }>,
  dates: string[],
  today: string,
): RangeStatus {
  const set = new Set(dates);
  const inRange = shifts.filter((s) => set.has(s.shift_date));
  if (inRange.length === 0) return 'empty';

  const drafts = inRange.filter((s) => s.status === 'DRAFT').length;
  if (drafts === inRange.length) return 'draft';
  if (drafts > 0) return 'mixed';

  const lastDate = dates[dates.length - 1];
  return isElapsed(lastDate, today) ? 'locked' : 'published';
}

export interface OverlapCandidate {
  is_full_day: boolean;
  starts_at?: Date | null;
  ends_at?: Date | null;
}

/**
 * Two exceptions on one day may not overlap, or the engine would score the same
 * hour twice. Half-open comparison, so 8–10 and 10–12 are adjacent; a full-day
 * exception collides with everything. Returns true when the candidate conflicts
 * with any existing row.
 */
export function exceptionsOverlap(existing: OverlapCandidate[], candidate: OverlapCandidate): boolean {
  for (const ex of existing) {
    if (ex.is_full_day || candidate.is_full_day) return true;
    if (!ex.starts_at || !ex.ends_at || !candidate.starts_at || !candidate.ends_at) continue;
    if (candidate.starts_at < ex.ends_at && ex.starts_at < candidate.ends_at) return true;
  }
  return false;
}

/**
 * Combine a 'YYYY-MM-DD' date with an 'HH:MM' or 'HH:MM:SS' wall-clock time into
 * a local Date. The server runs single-zone (America/New_York), so local time
 * IS wall-clock time, matching how punch data is stored.
 */
export function combineLocal(dateStr: string, hms: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const parts = hms.split(':').map(Number);
  return new Date(y, m - 1, d, parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}

/**
 * Extract 'HH:MM:SS' from a Prisma Time value. Prisma represents `@db.Time` as
 * a Date on 1970-01-01 in UTC, so UTC getters give the stored wall-clock time.
 */
export function hmsFromTime(t: Date): string {
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const ss = String(t.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── Prisma column mapping ─────────────────────────────────────────────────────
// `@db.Date` round-trips through UTC midnight, so date-only columns use UTC
// getters/setters. `@db.DateTime` round-trips a wall-clock instant through the
// process timezone (single-zone server), so datetime columns use LOCAL getters.

/** Build the Date to store in a `@db.Date` column from a 'YYYY-MM-DD' string. */
export function dateOnlyValue(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Read a 'YYYY-MM-DD' string from a `@db.Date` column value. */
export function dateStrFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Read 'HH:MM' wall-clock from a `@db.DateTime` column value. */
export function hmFromDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
