/**
 * attendance.engine — joins the PLAN (scheduleProvider) to the ACTUALS
 * (punchProvider) and writes the two derived tables. This is the only module
 * that writes attendance_daily or attendance_occurrence.
 *
 * Guarantees, in order of how much damage their absence would do:
 *
 *   1. FEED COVERAGE. A day is scored only where punch data actually reaches.
 *      Without this, every unimported day becomes a company-wide absence.
 *   2. IDEMPOTENT AND TRANSACTIONAL. Recompute deletes and reinserts a range
 *      inside one transaction, so a concurrent reader never sees a half-rebuilt
 *      window reading zero points, and running it twice changes nothing.
 *   3. SINGLE FLIGHT. Two overlapping recomputes would interleave their deletes
 *      and inserts, so they are serialised.
 *   4. EFFECTIVE-DATED RULES. Each day is scored under the bands in force on
 *      that day, so a policy edit cannot rewrite a delivered warning.
 *
 * Policy: absences count PER DAY (consecutive days out are separate
 * occurrences) and a day is NOT capped, so late + short earns both.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { getScheduledShifts } from './scheduleProvider';
import type { ScheduledDay } from './scheduleProvider';
import { getPunchCoverage, getPunchDays } from './punchProvider';
import type { PunchWindow } from './punchProvider';
import { loadPointRules } from './attendance.config';
import { getPointsStartDate } from './attendance.settings';
import {
  matchBand,
  exceedsLateBands,
  absenceRule,
  exceptionRule,
  formatDeviation,
} from './attendance.rules';
import type { PointRule, AttendanceKind } from './attendance.rules';
import { combineLocal, parseLocal, addDays, dateOnlyValue } from '../scheduling/schedule.dates';

/**
 * The attendance policy applies to CSRs only. Managers, QA, trainers and admins
 * are never scored, even when one carries a published shift and a stray punch or
 * two — which is exactly how a manager landed a false absence. Filtering here, at
 * the single writer of attendance_daily, keeps every downstream read CSR-only
 * without repeating the clause. Matches the `role_id = 3` convention used across
 * the Insights services (QCKpiService, QCQualityData).
 */
const CSR_ROLE_ID = 3;

interface DailyRow {
  user_id: number;
  work_date: Date;
  shift_id: number | null;
  scheduled_minutes: number;
  adherent_minutes: number;
  late_seconds: number;
  early_leave_seconds: number;
  is_absent: boolean;
  first_punch_at: Date | null;
  last_punch_at: Date | null;
  is_excused: boolean;
  excused_exception_id: number | null;
}

interface OccurrenceRow {
  user_id: number;
  work_date: Date;
  rule_id: number | null;
  kind: AttendanceKind;
  deviation_seconds: number;
  points: number;
  reason_label: string;
}

export interface RecomputeResult {
  from: string;
  to: string;
  daysScored: number;
  occurrences: number;
  /** Scheduled days on a date nobody in the company punched — feed gap or closure. */
  skippedNoFeed: number;
  /** Scheduled days outside the person's own punch span — pre-hire or post-departure. */
  skippedOutsideUserSpan: number;
  /** Users with published shifts but no punch history at all, so nothing is knowable. */
  usersWithoutPunchData: number;
}

/** Shift end, rolled to the next day when the shift crosses midnight. */
function shiftBounds(dateStr: string, day: ScheduledDay): { start: Date; end: Date } | null {
  if (!day.start || !day.end) return null;
  const start = combineLocal(dateStr, day.start);
  let end = combineLocal(dateStr, day.end);
  if (end.getTime() <= start.getTime()) end = combineLocal(addDays(dateStr, 1), day.end);
  return { start, end };
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function minutesOfHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Scheduled PAID break minutes for the day — the allowance actual break time is
 * credited up to. Anything beyond it is overage and never reaches the numerator.
 * Unpaid segments (lunch) are excluded: lunch is already out of the denominator
 * and a long lunch simply shows up as fewer worked minutes.
 */
function breakAllowanceMinutes(day: ScheduledDay): number {
  let mins = 0;
  for (const seg of day.segments) {
    if (!seg.isPaid) continue;
    let s = minutesOfHm(seg.start);
    let e = minutesOfHm(seg.end);
    if (e < s) e += 24 * 60; // segment crosses midnight
    mins += Math.max(0, e - s);
  }
  return mins;
}

/**
 * Total minutes actually worked, as Schedule Adherence measured by CONFORMANCE:
 * it counts the total time delivered regardless of WHEN, so a break delayed for
 * coverage or a late arrival made up by staying late both net to 100%. Only time
 * genuinely not worked pulls it down — a long lunch (unpaid, never in workMinutes)
 * or break time beyond the paid allowance.
 *
 * A flawless day therefore still reads 100%: workMinutes covers the on-task time
 * and the scheduled paid break is credited in full. Capped at scheduled_minutes so
 * overtime never reads above 100%. A missing Clock Out is handled upstream (the
 * open Work block runs to shift end), so it counts as worked, not as leaving early.
 */
function adherentMinutes(
  scheduledMinutes: number,
  breakAllowance: number,
  workMinutes: number,
  breakMinutes: number,
): number {
  const creditedBreak = Math.min(breakMinutes, breakAllowance);
  return Math.min(scheduledMinutes, Math.max(0, workMinutes + creditedBreak));
}

/**
 * Seconds of deviation an excused windowed exception forgives. A full-day excused
 * exception is handled earlier and never reaches here; this is the partial case,
 * where forgiveness reduces the deviation instead of erasing the day.
 *
 * Only the part of the window that OVERLAPS the deviation counts — `[shift start,
 * first punch]` on arrival, `[last punch, shift end]` on departure. Crediting the
 * window's whole length instead would let a mid-shift appointment erase lateness
 * it never covered, and would let one type carrying both edge flags forgive the
 * same absence twice: an afternoon PTO block would also excuse a morning arrival.
 * That second case is what allows a single Paychex-linked type to serve both a
 * full day and either edge, rather than needing a matched pair of types.
 */
function excusedSeconds(
  dateStr: string,
  day: ScheduledDay,
  edge: 'arrival' | 'departure',
  deviationStart: number,
  deviationEnd: number,
): number {
  let seconds = 0;
  for (const ex of day.exceptions) {
    if (!ex.isExcused || ex.isFullDay || !ex.start || !ex.end) continue;
    const applies = edge === 'arrival' ? ex.affectsArrival : ex.affectsDeparture;
    if (!applies) continue;
    let start = combineLocal(dateStr, ex.start).getTime();
    let end = combineLocal(dateStr, ex.end).getTime();
    if (end <= start) end = combineLocal(addDays(dateStr, 1), ex.end).getTime();
    seconds += Math.round(overlapMs(deviationStart, deviationEnd, start, end) / 1000);
  }
  return seconds;
}

/**
 * Score one scheduled day. Returns null when the day carries no denominator.
 *
 * Exported for tests. It is pure — schedule in, rows out — and it is the function
 * that decides whether somebody gets a written warning, so its boundaries are
 * worth pinning down without a database.
 */
export function scoreDay(
  userId: number,
  dateStr: string,
  day: ScheduledDay,
  punch: {
    firstPunchAt: Date | null;
    lastPunchAt: Date | null;
    workMinutes: number;
    breakMinutes: number;
  },
  rules: PointRule[],
): { daily: DailyRow; occurrences: OccurrenceRow[] } | null {
  const bounds = shiftBounds(dateStr, day);
  if (day.isDayOff || !bounds || day.scheduledMinutes <= 0) return null;

  const workDate = dateOnlyValue(dateStr);
  const occurrences: OccurrenceRow[] = [];

  const daily: DailyRow = {
    user_id: userId,
    work_date: workDate,
    shift_id: day.shiftId,
    scheduled_minutes: day.scheduledMinutes,
    adherent_minutes: 0,
    late_seconds: 0,
    early_leave_seconds: 0,
    is_absent: false,
    first_punch_at: punch.firstPunchAt,
    last_punch_at: punch.lastPunchAt,
    is_excused: false,
    excused_exception_id: null,
  };

  // A full-day excused exception removes the day from both sides of compliance
  // and suppresses every occurrence. This is the path protected leave (FMLA,
  // bereavement, jury duty) takes, so it must never earn points.
  const fullDayExcused = day.exceptions.find((e) => e.isExcused && e.isFullDay);
  if (fullDayExcused) {
    daily.is_excused = true;
    daily.excused_exception_id = fullDayExcused.id;
    return { daily, occurrences };
  }

  // A point-bearing full-day exception (No Call / No Show) REPLACES the derived
  // absence rather than stacking on it — they were not there, and the manager's
  // classification is the more specific fact.
  for (const ex of day.exceptions) {
    if (!ex.isFullDay || ex.isExcused) continue;
    const rule = exceptionRule(rules, ex.typeId, dateStr);
    if (!rule) continue;
    daily.is_absent = true;
    occurrences.push({
      user_id: userId,
      work_date: workDate,
      rule_id: rule.id,
      kind: 'EXCEPTION',
      deviation_seconds: 0,
      points: rule.points,
      reason_label: rule.label,
    });
    return { daily, occurrences };
  }

  const pushAbsence = (): void => {
    daily.is_absent = true;
    daily.adherent_minutes = 0;
    const rule = absenceRule(rules, dateStr);
    if (!rule) return;
    occurrences.push({
      user_id: userId,
      work_date: workDate,
      rule_id: rule.id,
      kind: 'ABSENT',
      deviation_seconds: 0,
      points: rule.points,
      reason_label: rule.label,
    });
  };

  if (!punch.firstPunchAt) {
    pushAbsence();
    return { daily, occurrences };
  }

  const rawLate = Math.max(0, Math.round((punch.firstPunchAt.getTime() - bounds.start.getTime()) / 1000));
  const lateSeconds = Math.max(
    0,
    rawLate - excusedSeconds(dateStr, day, 'arrival', bounds.start.getTime(), punch.firstPunchAt.getTime()),
  );

  // So late the LATE ladder no longer covers it: a 9-hour "late arrival" on an
  // 8-hour shift means they were not there.
  if (exceedsLateBands(rules, lateSeconds, dateStr)) {
    daily.late_seconds = lateSeconds;
    pushAbsence();
    return { daily, occurrences };
  }

  const rawEarly = punch.lastPunchAt
    ? Math.max(0, Math.round((bounds.end.getTime() - punch.lastPunchAt.getTime()) / 1000))
    : 0;
  const earlySeconds = punch.lastPunchAt
    ? Math.max(
        0,
        rawEarly -
          excusedSeconds(dateStr, day, 'departure', punch.lastPunchAt.getTime(), bounds.end.getTime()),
      )
    : 0;

  daily.late_seconds = lateSeconds;
  daily.early_leave_seconds = earlySeconds;
  daily.adherent_minutes = adherentMinutes(
    day.scheduledMinutes,
    breakAllowanceMinutes(day),
    punch.workMinutes,
    punch.breakMinutes,
  );

  const lateBand = matchBand(rules, 'LATE', lateSeconds, dateStr);
  if (lateBand) {
    occurrences.push({
      user_id: userId,
      work_date: workDate,
      rule_id: lateBand.id,
      kind: 'LATE',
      deviation_seconds: lateSeconds,
      points: lateBand.points,
      reason_label: `${lateBand.label} (${formatDeviation(lateSeconds)})`,
    });
  }

  const earlyBand = matchBand(rules, 'EARLY_LEAVE', earlySeconds, dateStr);
  if (earlyBand) {
    occurrences.push({
      user_id: userId,
      work_date: workDate,
      rule_id: earlyBand.id,
      kind: 'EARLY_LEAVE',
      deviation_seconds: earlySeconds,
      points: earlyBand.points,
      reason_label: `${earlyBand.label} (${formatDeviation(earlySeconds)})`,
    });
  }

  return { daily, occurrences };
}

// Recomputes are serialised. Overlapping runs would interleave their deletes and
// inserts and leave a range half-scored.
let inFlight: Promise<unknown> = Promise.resolve();

/**
 * Rebuild attendance for a date range. Safe to call repeatedly — the range is
 * deleted and reinserted, so the result depends only on the current schedule,
 * punches and rules, never on what was there before.
 *
 * `userIds` omitted means every user with a published shift in the range.
 */
export async function recomputeRange(
  fromStr: string,
  toStr: string,
  userIds?: number[],
): Promise<RecomputeResult> {
  const run = inFlight.then(() => runRecompute(fromStr, toStr, userIds));
  inFlight = run.catch(() => undefined);
  return run;
}

async function runRecompute(
  fromStr: string,
  toStr: string,
  explicitUserIds?: number[],
): Promise<RecomputeResult> {
  // The policy did not exist before this date, so nothing earlier is ever scored
  // or deleted — raising the lower bound keeps recompute off pre-policy days
  // entirely, and the read layer floors to the same date.
  const start = await getPointsStartDate();
  if (fromStr < start) fromStr = start;

  const coverage = await getPunchCoverage();
  const effectiveTo = coverage.maxDate && coverage.maxDate < toStr ? coverage.maxDate : toStr;
  const empty: RecomputeResult = {
    from: fromStr,
    to: effectiveTo,
    daysScored: 0,
    occurrences: 0,
    skippedNoFeed: 0,
    skippedOutsideUserSpan: 0,
    usersWithoutPunchData: 0,
  };
  if (effectiveTo < fromStr) return empty;

  const shifts = await prisma.scheduleShift.findMany({
    where: {
      shift_date: { gte: dateOnlyValue(fromStr), lte: dateOnlyValue(effectiveTo) },
      status: 'PUBLISHED',
      is_day_off: false,
      ...(explicitUserIds ? { user_id: { in: explicitUserIds } } : {}),
    },
    select: { user_id: true },
    distinct: ['user_id'],
  });
  const scheduledUserIds = shifts.map((s) => s.user_id);
  if (scheduledUserIds.length === 0) return empty;

  // Only people the punch feed knows about can be scored. Four users in the
  // current data have published shifts and no punch history whatsoever; scoring
  // them produced 100 absences for days nobody can say anything about.
  const coveredUserIds = scheduledUserIds.filter((id) => coverage.byUser.has(id));
  const usersWithoutPunchData = scheduledUserIds.length - coveredUserIds.length;
  if (coveredUserIds.length === 0) return { ...empty, usersWithoutPunchData };

  // CSRs only (see CSR_ROLE_ID). This query doubles as the role gate and the
  // active-status lookup below, so a non-CSR is dropped before any day is scored.
  //
  // An INACTIVE user's span closes at their last punch: they left, and the
  // scheduled days still sitting after that date are stale schedule rows, not
  // absences. An ACTIVE user runs to the global watermark so a genuine absence
  // in the most recent week still counts.
  const users = await prisma.user.findMany({
    where: { id: { in: coveredUserIds }, role_id: CSR_ROLE_ID },
    select: { id: true, is_active: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return { ...empty, usersWithoutPunchData };

  const spanEnd = new Map<number, string>();
  for (const u of users) {
    const bounds = coverage.byUser.get(u.id)!;
    spanEnd.set(u.id, u.is_active ? effectiveTo : bounds.last);
  }

  const plan = await getScheduledShifts(userIds, parseLocal(fromStr), parseLocal(effectiveTo));

  const windows: PunchWindow[] = [];
  for (const [k, day] of plan) {
    const [uid, dateStr] = k.split(':');
    const bounds = shiftBounds(dateStr, day);
    if (!bounds || day.isDayOff) continue;
    windows.push({ userId: Number(uid), dateStr, start: bounds.start, end: bounds.end });
  }
  const punches = await getPunchDays(windows);

  const rules = await loadPointRules();
  const dailyRows: DailyRow[] = [];
  const occurrenceRows: OccurrenceRow[] = [];
  let skippedNoFeed = 0;
  let skippedOutsideUserSpan = 0;

  for (const [k, day] of plan) {
    const [uidStr, dateStr] = k.split(':');
    if (dateStr < fromStr || dateStr > effectiveTo) continue;

    // Nobody in the company punched on this date: a feed gap or an unrecorded
    // closure. Scoring it would manufacture absences for everyone scheduled.
    if (!coverage.datesWithData.has(dateStr)) {
      if (!day.isDayOff) skippedNoFeed++;
      continue;
    }

    const userId = Number(uidStr);
    const bounds = coverage.byUser.get(userId);
    if (!bounds) continue;
    if (dateStr < bounds.first || dateStr > (spanEnd.get(userId) ?? effectiveTo)) {
      if (!day.isDayOff) skippedOutsideUserSpan++;
      continue;
    }

    const scored = scoreDay(
      Number(uidStr),
      dateStr,
      day,
      punches.get(k) ?? { firstPunchAt: null, lastPunchAt: null, workMinutes: 0, breakMinutes: 0 },
      rules,
    );
    if (!scored) continue;
    dailyRows.push(scored.daily);
    occurrenceRows.push(...scored.occurrences);
  }

  const fromDate = dateOnlyValue(fromStr);
  const toDate = dateOnlyValue(effectiveTo);

  // The delete scope must NOT be the set of users we just scored, or rows for a
  // user who has since dropped out of the punch feed would survive forever and
  // recompute would stop being idempotent. Recomputing a range makes that range
  // authoritative; a targeted recompute narrows only by the caller's user list.
  await prisma.$transaction(async (tx) => {
    const scope = {
      work_date: { gte: fromDate, lte: toDate },
      ...(explicitUserIds ? { user_id: { in: explicitUserIds } } : {}),
    };
    await tx.attendanceOccurrence.deleteMany({ where: scope });
    await tx.attendanceDaily.deleteMany({ where: scope });
    if (dailyRows.length > 0) await tx.attendanceDaily.createMany({ data: dailyRows });
    if (occurrenceRows.length > 0) await tx.attendanceOccurrence.createMany({ data: occurrenceRows });
  });

  logger.info(
    `attendance recompute ${fromStr}..${effectiveTo}: ${dailyRows.length} days, ` +
      `${occurrenceRows.length} occurrences; skipped ${skippedNoFeed} (no feed for date), ` +
      `${skippedOutsideUserSpan} (outside person's punch span), ` +
      `${usersWithoutPunchData} users (no punch history)`,
  );

  return {
    from: fromStr,
    to: effectiveTo,
    daysScored: dailyRows.length,
    occurrences: occurrenceRows.length,
    skippedNoFeed,
    skippedOutsideUserSpan,
    usersWithoutPunchData,
  };
}
