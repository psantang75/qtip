/**
 * Contract tests for classifyTimeOff — the function that turns a Paychex
 * Non-Work block into a full-day or windowed exception. Pure, so no DB.
 *
 * Every case here is drawn from a real shape in the current punch feed, because
 * each one silently cost somebody attendance points before this module existed.
 *
 * Baseline shift is 08:30-17:00 with an unpaid 30-minute lunch, so
 * scheduledMinutes is 480 — a full day of PTO arrives as a 480-minute block.
 */
import { describe, it, expect } from 'vitest';
import { classifyTimeOff, mergeBlocks } from '../timeOff.classify';
import type { TimeOffBlock } from '../timeOff.classify';
import type { ScheduledDay, ScheduledSegment } from '../../attendance/scheduleProvider';

const D = '2026-06-05';

const LUNCH: ScheduledSegment = {
  activity: 'Lunch', start: '12:30', end: '13:00', isPaid: false, countsAsCoverage: false,
};

function day(o: Partial<ScheduledDay> = {}): ScheduledDay {
  return {
    shiftId: 900,
    start: '08:30',
    end: '17:00',
    isDayOff: false,
    scheduledMinutes: 480,
    segments: [LUNCH],
    exceptions: [],
    ...o,
  };
}

const at = (hhmm: string, dateStr = D): Date => new Date(`${dateStr}T${hhmm}:00`);
const block = (start: string, end: string): TimeOffBlock => ({ start: at(start), end: at(end) });
const span = (first: string | null, last: string | null) => ({
  first: first ? at(first) : null,
  last: last ? at(last) : null,
});

describe('mergeBlocks', () => {
  it('unions overlapping blocks and leaves disjoint ones alone', () => {
    const merged = mergeBlocks([block('13:00', '15:00'), block('08:30', '10:00'), block('09:30', '11:00')]);
    expect(merged.map(b => [b.start.getHours(), b.end.getHours()])).toEqual([[8, 11], [13, 15]]);
  });
});

describe('classifyTimeOff — full day', () => {
  it('treats a block sized to net hours as a full day even when it starts early', () => {
    // The most common shape in the feed: Paychex stamps a whole day of PTO from a
    // default 08:00 and sizes it to 8 NET hours, so it neither starts nor ends on
    // the shift. Reading the edges would call this a 30-minute early leave.
    const r = classifyTimeOff(D, day(), [block('08:00', '16:00')]);
    expect(r.kind).toBe('FULL_DAY');
  });

  it('treats an exactly-aligned block as a full day', () => {
    const r = classifyTimeOff(D, day(), [block('08:30', '17:00')]);
    expect(r.kind).toBe('FULL_DAY');
  });

  it('adds separate blocks together before deciding', () => {
    const r = classifyTimeOff(D, day(), [block('08:30', '12:30'), block('13:00', '17:00')]);
    expect(r.kind).toBe('FULL_DAY');
  });

  it('does not round a genuinely short day up to a full one', () => {
    const r = classifyTimeOff(D, day(), [block('08:30', '16:00')]);
    expect(r.kind).toBe('PARTIAL');
  });
});

describe('classifyTimeOff — partial day placement', () => {
  it('covers the morning when the punches show a late start', () => {
    // Four hours of PTO, and Paychex stamped it over the afternoon he actually
    // worked. The punches say the morning is what is missing.
    const r = classifyTimeOff(D, day(), [block('13:00', '17:00')], span('13:00', '17:04'));
    expect(r).toMatchObject({ kind: 'PARTIAL', windows: [{ start: '08:30', end: '13:00' }] });
  });

  it('covers the afternoon when the punches show an early finish', () => {
    // Half a day off after lunch. The window has to reach 17:00, not 16:30: the
    // unpaid lunch costs clock time but no leave, and stopping short would leave
    // an unexplained half hour that scores as an early leave.
    const r = classifyTimeOff(D, day(), [block('12:30', '16:30')], span('08:30', '12:30'));
    expect(r).toMatchObject({ kind: 'PARTIAL', windows: [{ start: '12:30', end: '17:00' }] });
  });

  it('falls back to the block position when there are no work punches', () => {
    const r = classifyTimeOff(D, day(), [block('08:30', '11:30')], span(null, null));
    expect(r).toMatchObject({ kind: 'PARTIAL', windows: [{ start: '08:30', end: '11:30' }] });
  });

  it('clamps a window that starts before the shift', () => {
    const r = classifyTimeOff(D, day(), [block('07:00', '10:00')]);
    expect(r).toMatchObject({ kind: 'PARTIAL', windows: [{ start: '08:30', end: '11:30' }] });
  });

  it('never runs a window past the end of the shift', () => {
    const r = classifyTimeOff(D, day(), [block('15:00', '19:00')], span('08:30', '15:00'));
    const w = r.kind === 'PARTIAL' ? r.windows[0] : null;
    expect(w?.end).toBe('17:00');
  });
});

describe('classifyTimeOff — days with nothing to excuse', () => {
  it('ignores a block on a day off', () => {
    expect(classifyTimeOff(D, day({ isDayOff: true, scheduledMinutes: 0 }), [block('08:30', '17:00')]))
      .toEqual({ kind: 'DAY_OFF' });
  });

  it('ignores a block on a company holiday, which reads as a day off', () => {
    expect(classifyTimeOff(D, day({ scheduledMinutes: 0 }), [block('08:30', '17:00')]))
      .toEqual({ kind: 'DAY_OFF' });
  });

  it('reports leave granted entirely outside the shift rather than forgiving it', () => {
    // Real case: a person on a 13:00-17:00 shift with an 08:30-12:30 unpaid block.
    // Crediting it would excuse hours they were never scheduled to work.
    const evening = day({ start: '13:00', end: '17:00', scheduledMinutes: 210, segments: [] });
    expect(classifyTimeOff(D, evening, [block('08:30', '12:30')])).toEqual({ kind: 'OUTSIDE_SHIFT' });
  });

  it('reports a block that only touches the shift boundary as outside it', () => {
    const r = classifyTimeOff(D, day(), [block('05:00', '08:30')]);
    expect(r).toEqual({ kind: 'OUTSIDE_SHIFT' });
  });
});

describe('classifyTimeOff — overnight shifts', () => {
  const overnight = day({
    start: '22:00', end: '06:00', scheduledMinutes: 450,
    segments: [{ activity: 'Lunch', start: '02:00', end: '02:30', isPaid: false, countsAsCoverage: false }],
  });

  it('measures a full day across midnight', () => {
    const r = classifyTimeOff(D, overnight, [
      { start: at('22:00'), end: new Date('2026-06-06T06:00:00') },
    ]);
    expect(r.kind).toBe('FULL_DAY');
  });

  it('places a partial window in the first half of an overnight shift', () => {
    const r = classifyTimeOff(D, overnight, [{ start: at('22:00'), end: new Date('2026-06-06T00:00:00') }]);
    expect(r).toMatchObject({ kind: 'PARTIAL', windows: [{ start: '22:00', end: '00:00' }] });
  });
});
