/**
 * Presence gate for adherence. Attendance owns "was this person here?", and
 * adherence only scores the time attendance says they were:
 *
 *   - Attendance exceptions (excused or not) drop their interval, or the whole
 *     day, out of the adherence universe — not a miss, not credited as 100%.
 *   - A day attendance scored ABSENT (no punches, or too late to count) is not
 *     scored for adherence at all; attendance already charged it.
 *   - A scheduled break/lunch wholly before the first or after the last punch is
 *     dropped; attendance already charged that time as late / early leave.
 *
 * Adherence exceptions (they WERE here, this break was approved) are a different
 * path in the engine.
 */
import prisma from '../../config/prisma';
import { dateOnlyValue, dateStrFromDate } from '../scheduling/schedule.dates';

export interface PresenceException {
  isFullDay: boolean;
  start: string | null;
  end: string | null;
}

export interface SecRange {
  startSec: number;
  endSec: number;
}

function hmToSec(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/** Full-day PTO / unpaid / NCNS / sick — approved or not. The whole day is out. */
export function isFullDayAbsence(exceptions: PresenceException[]): boolean {
  return exceptions.some((e) => e.isFullDay);
}

/**
 * Timed "not here" windows. Full-day rows are handled separately. A windowed
 * row with no start/end cannot be placed, so it suppresses nothing.
 */
export function absenceWindows(exceptions: PresenceException[]): SecRange[] {
  const out: SecRange[] = [];
  for (const e of exceptions) {
    if (e.isFullDay || !e.start || !e.end) continue;
    const startSec = hmToSec(e.start);
    let endSec = hmToSec(e.end);
    if (endSec <= startSec) endSec += 24 * 3600;
    out.push({ startSec, endSec });
  }
  return out;
}

export function overlapsAny(startSec: number, endSec: number, windows: SecRange[]): boolean {
  return windows.some((w) => Math.min(endSec, w.endSec) - Math.max(startSec, w.startSec) > 0);
}

/** Attendance's scored verdict for one person-day. */
export interface AttendanceVerdict {
  isAbsent: boolean;
  /** First → last punch as seconds from local midnight; null with no punches. */
  clockedIn: SecRange | null;
}

/** Seconds since local (ET) midnight for an instant. Process is ET-pinned. */
export function secOfDay(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

const HALF_DAY_SEC = 12 * 3600;

/**
 * 1-based seqs of scheduled segments lying WHOLLY outside the clocked-in span.
 * A partial overlap stays scored — someone 5 minutes late can still take the
 * break that was scheduled as they arrived. Times after midnight on an overnight
 * shift are rolled forward a day so they compare on the shift's own clock.
 */
export function offClockSeqs(
  scheduled: Array<{ startSec: number; endSec: number }>,
  span: SecRange | null,
): Set<number> {
  const seqs = new Set<number>();
  if (!span) return seqs;
  scheduled.forEach((s, i) => {
    const roll = s.startSec < span.startSec - HALF_DAY_SEC ? 24 * 3600 : 0;
    if (s.endSec + roll <= span.startSec || s.startSec + roll >= span.endSec) seqs.add(i + 1);
  });
  return seqs;
}

/**
 * Attendance verdicts for a range, keyed `${userId}:${YYYY-MM-DD}`. Attendance is
 * always rescored before adherence (import, schedule change, exempt flag), so
 * these rows are current. A day attendance did not score has no entry and gets
 * no attendance gate.
 */
export async function loadAttendanceVerdicts(
  userIds: number[],
  fromStr: string,
  toStr: string,
): Promise<Map<string, AttendanceVerdict>> {
  const out = new Map<string, AttendanceVerdict>();
  if (userIds.length === 0) return out;
  const rows = await prisma.attendanceDaily.findMany({
    where: {
      user_id: { in: userIds },
      work_date: { gte: dateOnlyValue(fromStr), lte: dateOnlyValue(toStr) },
    },
    select: { user_id: true, work_date: true, is_absent: true, first_punch_at: true, last_punch_at: true },
  });
  for (const r of rows) {
    let clockedIn: SecRange | null = null;
    if (r.first_punch_at && r.last_punch_at) {
      const startSec = secOfDay(r.first_punch_at);
      let endSec = secOfDay(r.last_punch_at);
      if (r.last_punch_at.getTime() > r.first_punch_at.getTime() && endSec <= startSec) endSec += 24 * 3600;
      clockedIn = { startSec, endSec };
    }
    out.set(`${r.user_id}:${dateStrFromDate(r.work_date)}`, { isAbsent: r.is_absent, clockedIn });
  }
  return out;
}

/** 1-based seqs of scheduled segments whose window overlaps a "not here" block. */
export function absentScheduledSeqs(
  scheduled: Array<{ startSec: number; endSec: number }>,
  windows: SecRange[],
): Set<number> {
  const seqs = new Set<number>();
  scheduled.forEach((s, i) => {
    if (overlapsAny(s.startSec, s.endSec, windows)) seqs.add(i + 1);
  });
  return seqs;
}
