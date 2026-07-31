/**
 * Contract tests for the pure scheduling date/scope helpers. These are the
 * functions where the two costly classes of bug live:
 *   1. Sunday-vs-Monday week boundary (the business week is Sun→Sat).
 *   2. Copy/apply weekday mapping and 1-vs-7-vs-14 range sizing.
 * plus the lifecycle predicates (elapsed/locked/rangeStatus) and the
 * exception-overlap guard that keeps the KPI engine from double-counting an
 * hour. No DB — everything here is deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  fmtLocal,
  parseLocal,
  dayOfWeek,
  addDays,
  startOfWeek,
  weekDates,
  resolveApplyDates,
  sourceDateFor,
  isElapsed,
  isShiftLocked,
  rangeStatus,
  exceptionsOverlap,
} from '../schedule.dates';

describe('schedule.dates', () => {
  describe('local date round-trips', () => {
    it('fmtLocal/parseLocal are inverses with zero-padding', () => {
      expect(fmtLocal(parseLocal('2026-01-04'))).toBe('2026-01-04');
      expect(fmtLocal(new Date(2026, 8, 9))).toBe('2026-09-09');
    });

    it('addDays crosses month and year boundaries', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });
  });

  describe('week boundary is Sunday', () => {
    // 2026-07-31 is a Friday; the Sunday of its week is 2026-07-26.
    it('dayOfWeek: Sunday = 0, Saturday = 6', () => {
      expect(dayOfWeek('2026-07-26')).toBe(0); // Sunday
      expect(dayOfWeek('2026-08-01')).toBe(6); // Saturday
    });

    it('startOfWeek snaps back to the containing Sunday', () => {
      expect(startOfWeek('2026-07-31')).toBe('2026-07-26'); // Fri → Sun
      expect(startOfWeek('2026-07-26')).toBe('2026-07-26'); // Sun → itself
      expect(startOfWeek('2026-08-01')).toBe('2026-07-26'); // Sat → same Sun
    });

    it('weekDates returns seven Sun→Sat strings from any day of the week', () => {
      const expected = [
        '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29',
        '2026-07-30', '2026-07-31', '2026-08-01',
      ];
      expect(weekDates('2026-07-31')).toEqual(expected);
      expect(weekDates('2026-07-26')).toEqual(expected);
    });
  });

  describe('resolveApplyDates', () => {
    it('day scope returns exactly the one day, only from the day view', () => {
      expect(resolveApplyDates('day', 'day', '2026-07-30', '2026-07-30')).toEqual(['2026-07-30']);
      expect(() => resolveApplyDates('week', 'day', '2026-07-30', '2026-07-30')).toThrow();
    });

    it('week scope returns the 7 Sunday-aligned days regardless of anchor weekday', () => {
      expect(resolveApplyDates('week', 'week', '2026-07-30', '2026-07-30')).toHaveLength(7);
      expect(resolveApplyDates('week', 'week', '2026-07-30', '2026-07-30')[0]).toBe('2026-07-26');
    });

    it('period scope returns 14 contiguous days across two weeks', () => {
      const dates = resolveApplyDates('period', 'period', '2026-07-30', '2026-07-30');
      expect(dates).toHaveLength(14);
      expect(dates[0]).toBe('2026-07-26');
      expect(dates[7]).toBe('2026-08-02'); // second week's Sunday
      expect(dates[13]).toBe('2026-08-08');
    });
  });

  describe('sourceDateFor preserves weekday, not raw -7 offset', () => {
    it('maps each target weekday to the same weekday in the source week', () => {
      // Target Thursday 2026-08-06 pulled from source week of 2026-07-26 → its Thursday 2026-07-30.
      expect(sourceDateFor('2026-08-06', '2026-07-26')).toBe('2026-07-30');
      // A two-week target repeats the single source week (does not reach 14 days back).
      expect(sourceDateFor('2026-08-13', '2026-07-26')).toBe('2026-07-30');
    });
  });

  describe('lifecycle predicates', () => {
    it('isElapsed is strict (same-day is still editable)', () => {
      expect(isElapsed('2026-07-30', '2026-07-31')).toBe(true);
      expect(isElapsed('2026-07-31', '2026-07-31')).toBe(false);
      expect(isElapsed('2026-08-01', '2026-07-31')).toBe(false);
    });

    it('isShiftLocked only locks PUBLISHED + elapsed', () => {
      expect(isShiftLocked('2026-07-30', 'PUBLISHED', '2026-07-31')).toBe(true);
      expect(isShiftLocked('2026-07-30', 'DRAFT', '2026-07-31')).toBe(false); // elapsed draft stays editable
      expect(isShiftLocked('2026-08-05', 'PUBLISHED', '2026-07-31')).toBe(false); // future published
    });
  });

  describe('rangeStatus', () => {
    const dates = ['2026-08-03', '2026-08-04', '2026-08-05']; // future week
    it('empty when no shifts fall in range', () => {
      expect(rangeStatus([], dates, '2026-07-31')).toBe('empty');
    });
    it('draft when every in-range shift is DRAFT', () => {
      const shifts = dates.map(d => ({ shift_date: d, status: 'DRAFT' }));
      expect(rangeStatus(shifts, dates, '2026-07-31')).toBe('draft');
    });
    it('mixed when drafts and published coexist', () => {
      const shifts = [
        { shift_date: '2026-08-03', status: 'DRAFT' },
        { shift_date: '2026-08-04', status: 'PUBLISHED' },
      ];
      expect(rangeStatus(shifts, dates, '2026-07-31')).toBe('mixed');
    });
    it('published for a fully-published future range, locked once elapsed', () => {
      const future = dates.map(d => ({ shift_date: d, status: 'PUBLISHED' }));
      expect(rangeStatus(future, dates, '2026-07-31')).toBe('published');

      const past = ['2026-07-27', '2026-07-28'];
      const pastShifts = past.map(d => ({ shift_date: d, status: 'PUBLISHED' }));
      expect(rangeStatus(pastShifts, past, '2026-07-31')).toBe('locked');
    });
  });

  describe('exceptionsOverlap (half-open windows)', () => {
    const at = (h: number) => new Date(2026, 6, 30, h, 0, 0);
    const win = (s: number, e: number) => ({ is_full_day: false, starts_at: at(s), ends_at: at(e) });

    it('a full-day exception collides with anything', () => {
      expect(exceptionsOverlap([win(8, 10)], { is_full_day: true })).toBe(true);
      expect(exceptionsOverlap([{ is_full_day: true }], win(8, 10))).toBe(true);
    });

    it('adjacent windows do NOT overlap (8–10 and 10–12)', () => {
      expect(exceptionsOverlap([win(8, 10)], win(10, 12))).toBe(false);
    });

    it('genuinely overlapping windows conflict', () => {
      expect(exceptionsOverlap([win(8, 11)], win(10, 12))).toBe(true);
    });

    it('windows on a day with no existing rows never conflict', () => {
      expect(exceptionsOverlap([], win(8, 10))).toBe(false);
    });
  });
});
