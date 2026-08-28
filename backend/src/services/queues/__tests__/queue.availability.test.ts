/**
 * Availability math for queue coverage.
 *
 * These are the mistakes that would otherwise show up as a phantom body on the
 * plan: counting somebody who is at lunch, counting a half-day PTO as a whole
 * day, or reporting a queue as covered because it happened to be covered at the
 * one moment the code sampled.
 */
import { describe, it, expect } from 'vitest';
import type { ScheduledDay } from '../../attendance/scheduleProvider';
import {
  awayBands, buildSlots, containsMinute, coverageIntervals, covers, dayAxis, hmOf, minutesOf,
  overlapMinutes, span, spanOfAll, subtract, troughAcross,
} from '../queue.availability';

const iv = (start: string, end: string) => ({ startMin: minutesOf(start), endMin: minutesOf(end) });

const day = (over: Partial<ScheduledDay> = {}): ScheduledDay => ({
  shiftId: 1,
  start: '08:00',
  end: '17:00',
  isDayOff: false,
  scheduledMinutes: 480,
  segments: [],
  exceptions: [],
  ...over,
});

const segment = (start: string, end: string, countsAsCoverage: boolean) => ({
  activityTypeId: 1, activity: 'Lunch', start, end, isPaid: false, countsAsCoverage,
});

const exception = (start: string | null, end: string | null, isFullDay: boolean) => ({
  id: 1, typeId: 1, typeKey: 'PTO', label: 'PTO', isExcused: true,
  isFullDay, affectsArrival: false, affectsDeparture: false, start, end,
});

describe('minute helpers', () => {
  it('round-trips a wall-clock time', () => {
    expect(hmOf(minutesOf('13:45'))).toBe('13:45');
  });

  it('rolls an overnight span past midnight instead of going negative', () => {
    expect(span(minutesOf('22:00'), minutesOf('06:00'))).toEqual({ startMin: 1320, endMin: 1800 });
  });
});

describe('subtract', () => {
  it('splits an interval when the cut lands inside it', () => {
    expect(subtract([iv('08:00', '17:00')], iv('12:00', '12:30')))
      .toEqual([iv('08:00', '12:00'), iv('12:30', '17:00')]);
  });

  it('trims from an edge without splitting', () => {
    expect(subtract([iv('08:00', '17:00')], iv('08:00', '09:00'))).toEqual([iv('09:00', '17:00')]);
  });

  it('removes the interval entirely when the cut covers it', () => {
    expect(subtract([iv('08:00', '17:00')], iv('07:00', '18:00'))).toEqual([]);
  });

  it('leaves an interval alone when the cut only touches its edge', () => {
    expect(subtract([iv('08:00', '17:00')], iv('17:00', '18:00'))).toEqual([iv('08:00', '17:00')]);
  });
});

describe('coverageIntervals', () => {
  it('is the whole shift when nothing interrupts it', () => {
    expect(coverageIntervals(day())).toEqual([iv('08:00', '17:00')]);
  });

  it('removes a lunch, because somebody at lunch is not on the phone', () => {
    const intervals = coverageIntervals(day({ segments: [segment('12:00', '13:00', false)] }));
    expect(intervals).toEqual([iv('08:00', '12:00'), iv('13:00', '17:00')]);
  });

  it('keeps a segment that still counts as coverage', () => {
    const intervals = coverageIntervals(day({ segments: [segment('12:00', '13:00', true)] }));
    expect(intervals).toEqual([iv('08:00', '17:00')]);
  });

  it('removes only the hours of a partial exception', () => {
    const intervals = coverageIntervals(day({ exceptions: [exception('08:00', '12:00', false)] }));
    expect(intervals).toEqual([iv('12:00', '17:00')]);
  });

  it('returns nothing for a full-day exception', () => {
    expect(coverageIntervals(day({ exceptions: [exception(null, null, true)] }))).toEqual([]);
  });

  it('returns nothing for a day off, which is also how holidays arrive', () => {
    expect(coverageIntervals(day({ isDayOff: true }))).toEqual([]);
  });

  it('returns nothing for a person with no schedule at all', () => {
    expect(coverageIntervals(undefined)).toEqual([]);
  });
});

describe('overlap and coverage', () => {
  const intervals = [iv('08:00', '12:00'), iv('13:00', '17:00')];

  it('sums overlap across split intervals', () => {
    expect(overlapMinutes(intervals, iv('11:00', '14:00'))).toBe(120);
  });

  it('does not claim to cover a frame it has a hole in', () => {
    expect(covers(intervals, iv('11:00', '14:00'))).toBe(false);
    expect(covers(intervals, iv('13:00', '17:00'))).toBe(true);
  });

  it('treats an interval as half-open at its end', () => {
    expect(containsMinute(intervals, minutesOf('12:00'))).toBe(false);
    expect(containsMinute(intervals, minutesOf('11:59'))).toBe(true);
  });
});

describe('troughAcross', () => {
  it('reports the thinnest moment, not the average', () => {
    const a = [iv('08:00', '12:00'), iv('13:00', '17:00')];
    const b = [iv('08:00', '17:00')];
    expect(troughAcross([a, b], iv('08:00', '17:00'))).toBe(1);
  });

  it('is the full count when nobody has a hole', () => {
    const both = [iv('08:00', '17:00')];
    expect(troughAcross([both, both], iv('08:00', '17:00'))).toBe(2);
  });

  it('catches a gap shorter than a sampling grid would notice', () => {
    const a = [iv('08:00', '10:00'), iv('10:10', '17:00')];
    expect(troughAcross([a], iv('08:00', '17:00'))).toBe(0);
  });

  it('is zero when nobody is seated', () => {
    expect(troughAcross([], iv('08:00', '17:00'))).toBe(0);
  });

  it('ignores holes that fall outside the frame', () => {
    const a = [iv('08:00', '12:00'), iv('13:00', '17:00')];
    expect(troughAcross([a], iv('13:00', '17:00'))).toBe(1);
  });
});

describe('spanOfAll', () => {
  it('is the earliest start to the latest end across everyone', () => {
    expect(spanOfAll([[iv('09:00', '17:00')], [iv('07:00', '15:30')]]))
      .toEqual({ startMin: minutesOf('07:00'), endMin: minutesOf('17:00') });
  });

  it('is null when nobody is working', () => {
    expect(spanOfAll([[], []])).toBeNull();
  });
});

describe('dayAxis', () => {
  it('spans the hours people actually work, widened to whole hours', () => {
    // A literal midnight-to-midnight axis would report every queue as thinning
    // to zero, because nobody is on the phone at 3am.
    expect(dayAxis([[iv('08:30', '17:00')], [iv('09:00', '18:15')]]))
      .toEqual({ startMin: minutesOf('08:00'), endMin: minutesOf('19:00') });
  });

  it('is null when nobody is working, so there is no day to draw', () => {
    expect(dayAxis([[], []])).toBeNull();
  });
});

describe('buildSlots', () => {
  it('cuts the axis into quarter hours', () => {
    const slots = buildSlots({ startMin: minutesOf('08:00'), endMin: minutesOf('09:00') });
    expect(slots.map((s) => s.start)).toEqual(['08:00', '08:15', '08:30', '08:45']);
    expect(slots[3]).toEqual({ start: '08:45', end: '09:00', startMin: 525, endMin: 540 });
  });

  it('clips the last slot rather than overhanging the axis', () => {
    const slots = buildSlots({ startMin: minutesOf('08:00'), endMin: minutesOf('08:20') });
    expect(slots.map((s) => [s.start, s.end])).toEqual([['08:00', '08:15'], ['08:15', '08:20']]);
  });

  it('is empty when there is no axis', () => {
    expect(buildSlots(null)).toEqual([]);
  });
});

describe('awayBands', () => {
  it('reports a lunch as a break, using the activity name', () => {
    expect(awayBands(day({ segments: [segment('12:00', '13:00', false)] })))
      .toEqual([{ start: '12:00', end: '13:00', kind: 'BREAK', label: 'Lunch' }]);
  });

  it('ignores a segment that still counts as coverage', () => {
    expect(awayBands(day({ segments: [segment('12:00', '13:00', true)] }))).toEqual([]);
  });

  it('reports a partial exception as time off', () => {
    expect(awayBands(day({ exceptions: [exception('08:00', '12:00', false)] })))
      .toEqual([{ start: '08:00', end: '12:00', kind: 'TIME_OFF', label: 'PTO' }]);
  });

  it('clips a band that outlives the shift it hangs off', () => {
    // Shortening a shift leaves the original lunch in place, so this really happens.
    expect(awayBands(day({ end: '12:30', segments: [segment('12:00', '13:00', false)] })))
      .toEqual([{ start: '12:00', end: '12:30', kind: 'BREAK', label: 'Lunch' }]);
  });

  it('says nothing for a full-day absence — the whole row is off, not a band', () => {
    expect(awayBands(day({ exceptions: [exception(null, null, true)] }))).toEqual([]);
    expect(awayBands(day({ isDayOff: true }))).toEqual([]);
    expect(awayBands(undefined)).toEqual([]);
  });
});
