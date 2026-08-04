/**
 * The pure half of Paychex time-off derivation: given one day's schedule, its
 * Non-Work blocks and its work punches, decide what exception (if any) the day
 * earns. No database, no side effects — this is the code that decides whether a
 * PTO day costs somebody an attendance point, so it is worth pinning down in
 * tests without a fixture.
 *
 * The governing fact about the feed: Paychex reports a RELIABLE DURATION and an
 * UNRELIABLE ANCHOR. A full day of PTO comes back sized to the person's NET
 * hours but frequently stamped from a default start, and a half day is often
 * stamped over the hours the person actually worked rather than the ones they
 * missed. So length decides full-day, and the punches — not the block's own
 * timestamps — decide which half of the shift a partial day covers.
 */
import type { ScheduledDay } from '../attendance/scheduleProvider';
import { addDays, combineLocal, hmFromDateTime } from './schedule.dates';

/**
 * Rounding slack when comparing a block against the schedule. Paychex reports to
 * the minute and shifts are stored to the minute, so this only absorbs a stray
 * off-by-one; anything larger is a genuinely partial day.
 */
const FULL_DAY_TOLERANCE_MIN = 1;

export interface TimeOffBlock {
  start: Date;
  end: Date;
}

/** The day's actual work punches, ignoring Non-Work. Either end may be missing. */
export interface WorkSpan {
  first: Date | null;
  last: Date | null;
}

export type Classified =
  | { kind: 'DAY_OFF' }
  | { kind: 'OUTSIDE_SHIFT' }
  | { kind: 'FULL_DAY'; blockMinutes: number }
  | { kind: 'PARTIAL'; blockMinutes: number; windows: Array<{ start: string; end: string }> };

/** Union of overlapping or touching blocks, in order. */
export function mergeBlocks(blocks: TimeOffBlock[]): TimeOffBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: TimeOffBlock[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      if (b.end.getTime() > last.end.getTime()) last.end = b.end;
    } else {
      out.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  return out;
}

/** Unpaid segments of a shift as instants, in order. */
function unpaidIntervals(dateStr: string, day: ScheduledDay, boundsStart: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const seg of day.segments) {
    if (seg.isPaid) continue;
    let s = combineLocal(dateStr, seg.start).getTime();
    let e = combineLocal(dateStr, seg.end).getTime();
    if (e <= s) e = combineLocal(addDays(dateStr, 1), seg.end).getTime();
    // A segment timed before the shift start on an overnight shift belongs to the
    // morning half, matching how the engine and scheduleProvider place it.
    if (s < boundsStart) {
      s = combineLocal(addDays(dateStr, 1), seg.start).getTime();
      e = combineLocal(addDays(dateStr, 1), seg.end).getTime();
    }
    out.push([s, e]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Paid minutes between two instants, i.e. minutes of leave the gap would consume. */
function netMinutesBetween(from: number, to: number, unpaid: Array<[number, number]>): number {
  if (to <= from) return 0;
  let ms = to - from;
  for (const [s, e] of unpaid) ms -= Math.max(0, Math.min(to, e) - Math.max(from, s));
  return Math.round(Math.max(0, ms) / 60000);
}

/**
 * Where a person runs out of leave if they start missing work at `from` and are
 * granted `netMinutes` of it. Unpaid breaks cost clock time but no leave, so an
 * afternoon of PTO that straddles lunch has to reach half an hour further into
 * the day than its own length.
 *
 * Leave that runs out exactly at the start of a break absorbs the break too
 * (hence `>` and not `>=`). Someone off until 13:00 with a 12:30 lunch is not
 * expected at 12:30, and the engine measures lateness in CLOCK seconds — a
 * window stopping at 12:30 would leave the unpaid half hour scoring as late.
 */
function endAfterNetMinutes(
  from: number, netMinutes: number, unpaid: Array<[number, number]>, boundsEnd: number,
): number {
  let cursor = from;
  let remaining = netMinutes * 60000;
  for (const [segStart, segEnd] of unpaid) {
    if (segEnd <= cursor) continue;
    const paidBefore = Math.max(0, Math.min(segStart, boundsEnd) - cursor);
    if (paidBefore > remaining) return cursor + remaining;
    remaining -= paidBefore;
    cursor = Math.max(cursor, segEnd);
  }
  return Math.min(cursor + remaining, boundsEnd);
}

/** The mirror of endAfterNetMinutes, walking back from the end of the shift. */
function startBeforeNetMinutes(
  to: number, netMinutes: number, unpaid: Array<[number, number]>, boundsStart: number,
): number {
  let cursor = to;
  let remaining = netMinutes * 60000;
  for (const [segStart, segEnd] of [...unpaid].reverse()) {
    if (segStart >= cursor) continue;
    const paidAfter = Math.max(0, cursor - Math.max(segEnd, boundsStart));
    if (paidAfter > remaining) return cursor - remaining;
    remaining -= paidAfter;
    cursor = Math.min(cursor, segStart);
  }
  return Math.max(cursor - remaining, boundsStart);
}

/**
 * Which end of the shift a partial absence belongs to, from the punches rather
 * than from Paychex's stamp.
 *
 * The stamp cannot be trusted: in the current data one person took the morning
 * off and worked the afternoon, and Paychex placed the four-hour PTO block over
 * the four hours he had just worked. Anchoring there forgives nothing and leaves
 * a full point on a morning that was approved leave. The punches say plainly
 * which side of the shift is missing, so they decide.
 *
 * Falls back to the block's own position when there are no work punches to
 * compare against — a day entirely on leave, where placement changes nothing.
 */
function anchorWindow(
  block: TimeOffBlock,
  minutes: number,
  work: WorkSpan | undefined,
  unpaid: Array<[number, number]>,
  boundsStart: number,
  boundsEnd: number,
): { start: number; end: number } {
  const lead = work?.first ? netMinutesBetween(boundsStart, work.first.getTime(), unpaid) : 0;
  const trail = work?.last ? netMinutesBetween(work.last.getTime(), boundsEnd, unpaid) : 0;

  if (lead > 0 || trail > 0) {
    if (lead >= trail) {
      return { start: boundsStart, end: endAfterNetMinutes(boundsStart, minutes, unpaid, boundsEnd) };
    }
    return { start: startBeforeNetMinutes(boundsEnd, minutes, unpaid, boundsStart), end: boundsEnd };
  }

  const start = Math.max(block.start.getTime(), boundsStart);
  return { start, end: endAfterNetMinutes(start, minutes, unpaid, boundsEnd) };
}

/**
 * What one day's blocks of a single pay type mean against that day's schedule.
 *
 * A block that misses the shift entirely is OUTSIDE_SHIFT rather than a partial
 * day: Paychex grants leave against its own idea of the workday, and in the
 * current data two people took leave for hours they were never scheduled.
 *
 * Where placement is still wrong the engine simply forgives nothing — it credits
 * only the overlap with the real deviation — so the failure direction is a point
 * that stands and can be overridden by hand, never one that vanishes.
 */
export function classifyTimeOff(
  dateStr: string,
  day: ScheduledDay,
  blocks: TimeOffBlock[],
  work?: WorkSpan,
): Classified {
  if (day.isDayOff || !day.start || !day.end || day.scheduledMinutes <= 0) return { kind: 'DAY_OFF' };

  const boundsStart = combineLocal(dateStr, day.start).getTime();
  let boundsEnd = combineLocal(dateStr, day.end).getTime();
  if (boundsEnd <= boundsStart) boundsEnd = combineLocal(addDays(dateStr, 1), day.end).getTime();

  const merged = mergeBlocks(blocks).filter(
    (b) => b.end.getTime() > boundsStart && b.start.getTime() < boundsEnd,
  );
  if (merged.length === 0) return { kind: 'OUTSIDE_SHIFT' };

  const blockMinutes = Math.round(
    merged.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()), 0) / 60000,
  );
  if (blockMinutes + FULL_DAY_TOLERANCE_MIN >= day.scheduledMinutes) {
    return { kind: 'FULL_DAY', blockMinutes };
  }

  const unpaid = unpaidIntervals(dateStr, day, boundsStart);
  const windows: Array<{ start: string; end: string }> = [];
  for (const b of merged) {
    const minutes = Math.round((b.end.getTime() - b.start.getTime()) / 60000);
    // Only the first block gets the punch-derived anchor; a second block on the
    // same day has no unambiguous gap to claim, so it keeps its own position.
    const w = anchorWindow(b, minutes, windows.length === 0 ? work : undefined, unpaid, boundsStart, boundsEnd);
    if (w.end > w.start) {
      windows.push({
        start: hmFromDateTime(new Date(w.start)),
        end: hmFromDateTime(new Date(w.end)),
      });
    }
  }
  if (windows.length === 0) return { kind: 'OUTSIDE_SHIFT' };
  return { kind: 'PARTIAL', blockMinutes, windows };
}
