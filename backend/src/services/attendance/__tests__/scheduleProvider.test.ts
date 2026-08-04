/**
 * netMinutes is the compliance DENOMINATOR. Its only hard requirement is that it
 * counts exactly the same unpaid minutes the engine's numerator does, because any
 * disagreement shows up as a compliance percentage above 100 — which is the fastest
 * way to lose an audience for a discipline report.
 */
import { describe, it, expect } from 'vitest';
import { netMinutes } from '../scheduleProvider';
import type { ScheduledSegment } from '../scheduleProvider';

const seg = (start: string, end: string, isPaid: boolean): ScheduledSegment => ({
  activity: isPaid ? 'Break' : 'Lunch', start, end, isPaid, countsAsCoverage: false,
});

describe('netMinutes', () => {
  it('is the plain span when there are no segments', () => {
    expect(netMinutes('09:00', '17:00', [])).toBe(480);
  });

  it('deducts an unpaid segment inside the shift', () => {
    expect(netMinutes('09:00', '17:00', [seg('12:00', '12:30', false)])).toBe(450);
  });

  it('keeps paid breaks in', () => {
    expect(netMinutes('09:00', '17:00', [seg('10:00', '10:15', true)])).toBe(480);
  });

  it('ignores an unpaid segment entirely outside the shift', () => {
    // The real case: a shift shortened to 16:30 that kept its 17:30 lunch. The
    // engine can only subtract overlap it finds inside the shift, so deducting
    // the whole segment here produced 100.21% compliance.
    expect(netMinutes('12:30', '16:30', [seg('17:30', '18:00', false)])).toBe(240);
  });

  it('deducts only the part of an unpaid segment that overlaps the shift', () => {
    expect(netMinutes('09:00', '17:00', [seg('16:45', '17:15', false)])).toBe(465);
  });

  it('measures an overnight shift as its real length', () => {
    // Wall-clock subtraction gives -960 here. Clamped to zero it would leave the
    // day with no denominator and the engine would skip it without saying so.
    expect(netMinutes('22:00', '06:00', [])).toBe(480);
  });

  it('deducts an after-midnight unpaid break on an overnight shift', () => {
    expect(netMinutes('22:00', '06:00', [seg('02:00', '02:30', false)])).toBe(450);
  });

  it('deducts an unpaid break taken before midnight on an overnight shift', () => {
    expect(netMinutes('22:00', '06:00', [seg('23:00', '23:30', false)])).toBe(450);
  });

  it('never returns a negative denominator', () => {
    expect(netMinutes('09:00', '17:00', [seg('09:00', '17:00', false)])).toBe(0);
  });

  it('returns zero when the shift has no times', () => {
    expect(netMinutes(null, '17:00', [])).toBe(0);
    expect(netMinutes('09:00', null, [])).toBe(0);
  });
});
