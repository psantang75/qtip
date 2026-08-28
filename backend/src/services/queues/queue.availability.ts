/**
 * Who can actually take a call, and when.
 *
 * Pure interval math over what the work schedule already knows. No Prisma here —
 * the caller hands in `ScheduledDay` from scheduleProvider, which is the single
 * source of availability in the app; this module never queries shifts or
 * exceptions itself.
 *
 * "Available" is stricter than "scheduled and not on PTO". A person is on
 * coverage for the minutes that are inside their shift AND not inside a segment
 * whose activity does not count as coverage (lunch, training, a meeting) AND not
 * inside an exception window. A day off, a closure, or a full-day exception
 * leaves them with no coverage minutes at all.
 *
 * Everything is wall-clock minutes from midnight, half-open [start, end), which
 * is the same convention the schedule grid uses. Overnight shifts roll the end
 * past 1440 so a span is never negative.
 */
import type { ScheduledDay } from '../attendance/scheduleProvider';
import type { AwayBand, Interval, QueueSlot } from './queue.types';

const DAY_MINUTES = 24 * 60;

/**
 * The grain of the plan. Lunches, PTO windows and shift edges all land on
 * quarter hours, so anything coarser cannot see a lunch and anything finer only
 * multiplies the payload.
 */
export const SLOT_MINUTES = 15;

/** 'HH:MM' → minutes from midnight. */
export function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes from midnight → 'HH:MM'. Values past midnight wrap for display. */
export function hmOf(mins: number): string {
  const wrapped = ((mins % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** A span, rolled past midnight when it ends at or before it starts. */
export function span(startMin: number, endMin: number): Interval {
  return { startMin, endMin: endMin <= startMin ? endMin + DAY_MINUTES : endMin };
}

/**
 * Remove `cut` from every interval in `from`. A cut landing in the middle splits
 * the interval in two; one that covers it removes it entirely.
 */
export function subtract(from: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const iv of from) {
    if (cut.endMin <= iv.startMin || cut.startMin >= iv.endMin) {
      out.push(iv);
      continue;
    }
    if (cut.startMin > iv.startMin) out.push({ startMin: iv.startMin, endMin: cut.startMin });
    if (cut.endMin < iv.endMin) out.push({ startMin: cut.endMin, endMin: iv.endMin });
  }
  return out;
}

/** Total overlap in minutes between a set of intervals and one window. */
export function overlapMinutes(intervals: Interval[], window: Interval): number {
  let total = 0;
  for (const iv of intervals) {
    total += Math.max(0, Math.min(iv.endMin, window.endMin) - Math.max(iv.startMin, window.startMin));
  }
  return total;
}

/** True when the intervals cover every minute of the window. */
export function covers(intervals: Interval[], window: Interval): boolean {
  return overlapMinutes(intervals, window) >= window.endMin - window.startMin;
}

/** True when a minute falls inside any interval. */
export function containsMinute(intervals: Interval[], minute: number): boolean {
  return intervals.some((iv) => minute >= iv.startMin && minute < iv.endMin);
}

/**
 * The minutes one person can take calls on a given day.
 *
 * Returns an empty list for a day off, a holiday/closure (scheduleProvider has
 * already folded those into `isDayOff`), a shift with no times, or a full-day
 * exception — all of which mean "not available", for different reasons that do
 * not need distinguishing here.
 */
export function coverageIntervals(day: ScheduledDay | undefined): Interval[] {
  if (!day || day.isDayOff || !day.start || !day.end) return [];
  if (day.exceptions.some((e) => e.isFullDay)) return [];

  let intervals: Interval[] = [span(minutesOf(day.start), minutesOf(day.end))];

  for (const seg of day.segments) {
    if (seg.countsAsCoverage) continue;
    intervals = subtract(intervals, span(minutesOf(seg.start), minutesOf(seg.end)));
  }

  for (const ex of day.exceptions) {
    if (!ex.start || !ex.end) continue;
    intervals = subtract(intervals, span(minutesOf(ex.start), minutesOf(ex.end)));
  }

  return intervals.filter((iv) => iv.endMin > iv.startMin);
}

/**
 * The thinnest moment in a frame: the fewest people on coverage at any point in
 * it. Sampled at boundaries rather than on a fixed grid, because every change in
 * headcount happens at somebody's interval edge — a 15-minute grid would both
 * cost more and miss a 10-minute gap.
 */
export function troughAcross(intervalsPerPerson: Interval[][], frame: Interval): number {
  if (intervalsPerPerson.length === 0) return 0;

  const boundaries = new Set<number>([frame.startMin]);
  for (const intervals of intervalsPerPerson) {
    for (const iv of intervals) {
      if (iv.startMin > frame.startMin && iv.startMin < frame.endMin) boundaries.add(iv.startMin);
      if (iv.endMin > frame.startMin && iv.endMin < frame.endMin) boundaries.add(iv.endMin);
    }
  }

  let lowest = Number.POSITIVE_INFINITY;
  for (const point of boundaries) {
    let count = 0;
    for (const intervals of intervalsPerPerson) if (containsMinute(intervals, point)) count++;
    if (count < lowest) lowest = count;
  }
  return lowest === Number.POSITIVE_INFINITY ? 0 : lowest;
}

/**
 * The outer bounds of everyone's coverage for a day: earliest start to latest
 * end. Null when nobody is working.
 */
export function spanOfAll(intervalsPerPerson: Interval[][]): Interval | null {
  let startMin = Number.POSITIVE_INFINITY;
  let endMin = Number.NEGATIVE_INFINITY;
  for (const intervals of intervalsPerPerson) {
    for (const iv of intervals) {
      if (iv.startMin < startMin) startMin = iv.startMin;
      if (iv.endMin > endMin) endMin = iv.endMin;
    }
  }
  return startMin === Number.POSITIVE_INFINITY ? null : { startMin, endMin };
}

/** 'HH:MM', except that the end of the day reads 24:00 rather than 00:00. */
export const slotLabel = (mins: number): string =>
  (mins >= DAY_MINUTES && mins % DAY_MINUTES === 0 ? '24:00' : hmOf(mins));

/**
 * The day's time axis: the hours these people actually work, widened to whole
 * hours so the ruler reads in round numbers.
 *
 * Deliberately NOT the department's coverage windows. Those grade the schedule,
 * and a shift that starts an hour before the first window would simply vanish
 * from the board. Null when nobody is working — there is no day to draw.
 */
export function dayAxis(intervalsPerPerson: Interval[][]): Interval | null {
  const span_ = spanOfAll(intervalsPerPerson);
  if (!span_) return null;
  return {
    startMin: Math.floor(span_.startMin / 60) * 60,
    endMin: Math.ceil(span_.endMin / 60) * 60,
  };
}

/** The axis cut into slots. The last one is clipped rather than overhanging. */
export function buildSlots(axis: Interval | null, slotMinutes = SLOT_MINUTES): QueueSlot[] {
  if (!axis || axis.endMin <= axis.startMin) return [];
  const slots: QueueSlot[] = [];
  for (let m = axis.startMin; m < axis.endMin; m += slotMinutes) {
    const endMin = Math.min(m + slotMinutes, axis.endMin);
    slots.push({ start: slotLabel(m), end: slotLabel(endMin), startMin: m, endMin });
  }
  return slots;
}

/**
 * The carve-outs of one person's day, so the grid can say "at lunch" or "on
 * PTO" instead of drawing an unexplained hole.
 *
 * This is the same source `coverageIntervals` subtracts from — segments that do
 * not count as coverage, plus exception windows — reported rather than removed,
 * so the two can never disagree about when somebody is away.
 */
export function awayBands(day: ScheduledDay | undefined): AwayBand[] {
  if (!day || day.isDayOff || !day.start || !day.end) return [];

  const shift = span(minutesOf(day.start), minutesOf(day.end));
  const clip = (startMin: number, endMin: number): Interval | null => {
    const s = Math.max(shift.startMin, startMin);
    const e = Math.min(shift.endMin, endMin);
    return e > s ? { startMin: s, endMin: e } : null;
  };

  const bands: AwayBand[] = [];
  for (const seg of day.segments) {
    if (seg.countsAsCoverage) continue;
    const iv = clip(minutesOf(seg.start), minutesOf(seg.end));
    if (iv) bands.push({ start: hmOf(iv.startMin), end: hmOf(iv.endMin), kind: 'BREAK', label: seg.activity });
  }
  for (const ex of day.exceptions) {
    if (ex.isFullDay || !ex.start || !ex.end) continue;
    const iv = clip(minutesOf(ex.start), minutesOf(ex.end));
    if (iv) bands.push({ start: hmOf(iv.startMin), end: hmOf(iv.endMin), kind: 'TIME_OFF', label: ex.label });
  }
  return bands.sort((a, b) => a.start.localeCompare(b.start));
}
