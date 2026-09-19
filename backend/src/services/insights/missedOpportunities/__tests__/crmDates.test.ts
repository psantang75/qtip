/**
 * CRM date semantics, and why they are worth their own module.
 *
 * `CompletedOn` is NOT NULL in this CRM. An open task carries the `0001-01-01`
 * sentinel (older rows `0000-00-00`), so `CompletedOn IS NULL` matches nothing —
 * the resolver read every task, fulfilled or years closed, as still open, and
 * selection fell through to "whichever record has the nearest note".
 *
 * The failure direction matters as much as the rule. A value we cannot parse must
 * be `unknown`, never `open`: collapsing the two would let a parsing failure
 * promote a finished task back into being the current sales record, which is the
 * wrong way to be wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  completionState, crmDate, crmEventTime, endOfCallDay, formatCrmDay, formatCrmMoment, isOpen,
  toCrmTimestamp,
} from '../crmDates';

describe('completionState — open, completed, or genuinely unknown', () => {
  it.each([
    ['0001-01-01 00:00:00', 'the documented open sentinel'],
    ['0001-01-01 05:00:00', 'the CAST(... AS CHAR) form JS reads as year 2001'],
    ['0000-00-00 00:00:00', 'the older zero date'],
    ['0000-00-00', 'the older zero date without a time'],
    ['', 'an empty string'],
  ])('reads %s as open — %s', (value) => {
    expect(completionState(value)).toBe('open');
    expect(isOpen(value)).toBe(true);
  });

  it('reads a real timestamp as completed', () => {
    expect(completionState('2026-08-30 16:00:00')).toBe('completed');
    expect(isOpen('2026-08-30 16:00:00')).toBe(false);
  });

  it('reads an unparseable value as unknown, NOT as open', () => {
    expect(completionState('not-a-date')).toBe('unknown');
    expect(isOpen('not-a-date')).toBe(false);
  });

  it('treats a missing column as open, since nothing was ever completed', () => {
    expect(completionState(null)).toBe('open');
    expect(completionState(undefined)).toBe('open');
  });

  it('handles a Date the driver already parsed, sentinel included', () => {
    expect(completionState(new Date('2026-08-30T16:00:00Z'))).toBe('completed');
    // mysql2 turns the sentinel into a pre-1970 Date rather than a string.
    expect(completionState(new Date('0001-01-01T00:00:00Z'))).toBe('open');
    expect(completionState(new Date('nope'))).toBe('unknown');
  });

  it('does not accept a non-date object as a completion', () => {
    expect(completionState(42 as unknown as string)).toBe('unknown');
  });
});

describe('crmDate', () => {
  it('returns null for a sentinel so it can never be ordered as history', () => {
    expect(crmDate('0001-01-01 05:00:00')).toBeNull();
    expect(crmDate('0000-00-00')).toBeNull();
  });

  it('parses a real CRM timestamp', () => {
    expect(crmDate('2026-09-04 15:30:00')?.getFullYear()).toBe(2026);
  });

  it('tolerates surrounding whitespace from a CAST', () => {
    expect(crmDate('  2026-09-04 15:30:00  ')?.getDate()).toBe(4);
  });
});

/**
 * A `tblAction` row is CREATED when a follow-up is scheduled and COMPLETED when
 * someone works it. `COALESCE(CompletedOn, CreatedOn)` cannot express that on a
 * non-null sentinel column, and where it does fall through it dates completed
 * work to when it was scheduled.
 */
describe('crmEventTime — scheduled work is not finished work', () => {
  it('dates a completed action by its completion', () => {
    const e = crmEventTime('2026-09-04 15:30:00', '2026-09-01 09:00:00');
    expect(e.basis).toBe('completed');
    expect(e.at?.getDate()).toBe(4);
  });

  it('dates a still-scheduled action by its creation and says so', () => {
    const e = crmEventTime('0001-01-01 05:00:00', '2026-09-04 09:00:00');
    expect(e.basis).toBe('scheduled');
    expect(e.at?.getDate()).toBe(4);
  });

  it('falls back to creation when a completed action has an unusable completion', () => {
    const e = crmEventTime('not-a-date', '2026-09-04 09:00:00');
    expect(e.at?.getDate()).toBe(4);
  });

  it('reports unknown when neither column is usable', () => {
    expect(crmEventTime('0000-00-00', '0000-00-00')).toEqual({ at: null, basis: 'unknown' });
  });
});

describe('day boundaries use the local day, per the project date convention', () => {
  it('ends the cutoff at the last second of the call\'s own day', () => {
    expect(endOfCallDay(new Date(2026, 8, 4, 14, 30))).toBe('2026-09-04 23:59:59');
  });

  it('does not roll a late-evening call into the next day', () => {
    // toISOString would move the boundary a day west of Greenwich and silently
    // cut the evening's notes — the salesperson's own post-call follow-up.
    expect(endOfCallDay(new Date(2026, 8, 4, 23, 45))).toBe('2026-09-04 23:59:59');
  });

  it('handles a year boundary', () => {
    expect(endOfCallDay(new Date(2025, 11, 31, 18, 0))).toBe('2025-12-31 23:59:59');
  });

  it('keeps the local day across a DST transition', () => {
    // US DST ends 2026-11-01. Both calls belong to that same local day.
    expect(endOfCallDay(new Date(2026, 10, 1, 1, 30))).toBe('2026-11-01 23:59:59');
    expect(endOfCallDay(new Date(2026, 10, 1, 23, 30))).toBe('2026-11-01 23:59:59');
  });

  it('renders a CRM-comparable timestamp from local components', () => {
    expect(toCrmTimestamp(new Date(2026, 8, 4, 9, 5, 7))).toBe('2026-09-04 09:05:07');
  });
});

describe('note header formatting', () => {
  it('renders a moment to the minute', () => {
    expect(formatCrmMoment('2026-09-04 15:30:00')).toBe('2026-09-04 15:30');
  });

  it('renders a due date to the day', () => {
    expect(formatCrmDay('2026-09-18 00:00:00')).toBe('2026-09-18');
  });

  it('returns null for a sentinel, so no line claims a date it does not have', () => {
    expect(formatCrmMoment('0001-01-01 05:00:00')).toBeNull();
    expect(formatCrmDay('0000-00-00')).toBeNull();
    expect(formatCrmDay(null)).toBeNull();
  });
});
