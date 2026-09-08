/**
 * adherence.engine — joins the PLAN (scheduled break/lunch segments) to the
 * ACTUALS (punch break/meal blocks) and the PHONE (Genesys Break/Meal presence),
 * and writes the two derived tables. The only module that writes adherence_daily
 * or adherence_occurrence. Mirrors attendance.engine.ts's guarantees:
 *
 *   1. FEED COVERAGE. A day is scored only where punch data actually reaches, so
 *      an unimported day never manufactures a company-wide "missed break".
 *   2. IDEMPOTENT + TRANSACTIONAL. Recompute deletes and reinserts a range in one
 *      transaction; running it twice changes nothing.
 *   3. SINGLE FLIGHT. Overlapping recomputes are serialised.
 *   4. EFFECTIVE-DATED RULES. Each day scores under the bands in force that day.
 *
 * Policy: only SCHEDULED break/lunch segments are scored (the agent's published
 * schedule is the plan). A scheduled segment with no matching punch is a MISS;
 * extra unscheduled breaks are not scored (there is no plan to compare them to).
 * Attendance exceptions mean the person was not here — those intervals drop out
 * of the universe (full-day → no row; overlapping segments → not recorded),
 * excused or not. Points are always stored on the occurrence; whether they COUNT
 * toward the ladder is gated later, at read time, by adherence_points_active_from.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { getScheduledShifts } from '../attendance/scheduleProvider';
import type { ScheduledDay } from '../attendance/scheduleProvider';
import { getPunchCoverage } from '../attendance/punchProvider';
import type { PunchWindow } from '../attendance/punchProvider';
import { getPunchSegments } from './breakPunchProvider';
import { getPhonePresence } from './phonePresenceProvider';
import type { PhoneSpan, PhonePresence } from './phonePresenceProvider';
import { loadPointRules } from './adherence.config';
import { getAdherenceStartDate, getPhoneGrace } from './adherence.settings';
import { getPunchExemptUserIds } from '../attendance/punchExempt.settings';
import type { PhoneGrace } from './adherence.settings';
import { matchBand, missedRule, formatDeviation } from './adherence.rules';
import type { PointRule, AdherenceKind } from './adherence.rules';
import {
  isFullDayAbsence, absenceWindows, absentScheduledSeqs, overlapsAny,
} from './adherence.presence';
import type { PresenceException, SecRange } from './adherence.presence';
import { combineLocal, parseLocal, addDays, dateOnlyValue, dateStrFromDate } from '../scheduling/schedule.dates';

/** The policy scores CSRs only, exactly like attendance (role_id = 3). */
const CSR_ROLE_ID = 3;

/** Seconds since local (ET) midnight for a punch instant. Process is ET-pinned. */
function secOfDay(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** 'HH:MM' → seconds since midnight. */
function secOfHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/** Shift end rolled to the next day when the shift crosses midnight. */
function shiftBounds(dateStr: string, day: ScheduledDay): { start: Date; end: Date } | null {
  if (!day.start || !day.end) return null;
  const start = combineLocal(dateStr, day.start);
  let end = combineLocal(dateStr, day.end);
  if (end.getTime() <= start.getTime()) end = combineLocal(addDays(dateStr, 1), day.end);
  return { start, end };
}

export interface ScheduledSeg { startSec: number; endSec: number }
export interface ActualSeg { startSec: number; endSec: number; durationSec: number }

/**
 * The seqs (1-based, sorted-by-start within a family) of the break/lunch
 * instances that carry an EXCUSED adherence exception for a day. An excused
 * segment's punch-side points are forgiven — its duration, start, and miss rows
 * are suppressed and it counts as fully adherent. Adherence-only: phone is never
 * forgiven here (it flows off the actual punch), and the schedule/punch are
 * untouched. Unexcused exceptions are recorded elsewhere but never reach scoring.
 */
export interface DayExcusals {
  breaks: Set<number>;
  lunches: Set<number>;
}
const EMPTY_EXCUSALS: DayExcusals = { breaks: new Set(), lunches: new Set() };

interface DailyRow {
  user_id: number;
  work_date: Date;
  shift_id: number | null;
  break_scheduled_sec: number;
  break_actual_sec: number;
  lunch_scheduled_sec: number;
  lunch_actual_sec: number;
  phone_break_extra_sec: number;
  phone_lunch_extra_sec: number;
  adherence_pct: number | null;
}

interface OccurrenceRow {
  user_id: number;
  work_date: Date;
  seq: number;
  rule_id: number | null;
  kind: AdherenceKind;
  deviation_seconds: number;
  scheduled_start_sec: number | null;
  scheduled_end_sec: number | null;
  actual_start_sec: number | null;
  actual_end_sec: number | null;
  phone_start_sec: number | null;
  phone_end_sec: number | null;
  points: number;
  reason_label: string;
}

export interface RecomputeResult {
  from: string;
  to: string;
  daysScored: number;
  occurrences: number;
  skippedNoFeed: number;
  skippedOutsideUserSpan: number;
  usersWithoutPunchData: number;
}

interface SegmentKinds {
  duration: AdherenceKind;
  start: AdherenceKind;
  phoneStart: AdherenceKind;
  phoneStop: AdherenceKind;
  missed: 'BREAK_MISSED' | 'LUNCH_MISSED';
}

const BREAK_KINDS: SegmentKinds = {
  duration: 'BREAK_DURATION', start: 'BREAK_START',
  phoneStart: 'BREAK_PHONE_START', phoneStop: 'BREAK_PHONE_STOP', missed: 'BREAK_MISSED',
};
const LUNCH_KINDS: SegmentKinds = {
  duration: 'LUNCH_DURATION', start: 'LUNCH_START',
  phoneStart: 'LUNCH_PHONE_START', phoneStop: 'LUNCH_PHONE_STOP', missed: 'LUNCH_MISSED',
};

interface SegmentScore {
  occurrences: OccurrenceRow[];
  scheduledSec: number;
  actualSec: number;
  phoneExtraSec: number;
  /** Absolute deviation used for the day's adherence_pct. */
  deviationSec: number;
}

/**
 * Claim the unused phone span that overlaps this punch the most, marking it used
 * so a later punch cannot double-count it. Returns null when nothing overlaps —
 * with no corresponding phone-Break there is no start/stop to compare, which is
 * correct: phone matching is punch-vs-phone, not a bare "phone was on at all".
 */
function takeOverlappingPhone(
  act: ActualSeg,
  phones: PhoneSpan[],
  used: boolean[],
): PhoneSpan | null {
  let bestIdx = -1;
  let bestOverlap = 0;
  for (let j = 0; j < phones.length; j++) {
    if (used[j]) continue;
    const p = phones[j];
    const overlap = Math.min(act.endSec, p.endSec) - Math.max(act.startSec, p.startSec);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = j;
    }
  }
  if (bestIdx < 0) return null;
  used[bestIdx] = true;
  return phones[bestIdx];
}

/**
 * Score one segment type (break or lunch) for a day. There are exactly TWO
 * independent comparisons, both per break/lunch INSTANCE (paired by sorted order):
 *
 *   1. SCHEDULED ↔ PUNCH — start (punch start vs scheduled start) and duration
 *      (punch length vs scheduled length). There is no separate end check: the end
 *      is governed by duration. A scheduled instance with no punch is a MISS.
 *   2. PUNCH ↔ PHONE — phone start vs punch start and phone stop vs punch stop,
 *      beyond the admin before/after tolerance. Phone never touches the schedule.
 */
function scoreSegment(
  userId: number,
  workDate: Date,
  dateStr: string,
  kinds: SegmentKinds,
  scheduled: ScheduledSeg[],
  actual: ActualSeg[],
  phone: PhoneSpan[],
  rules: PointRule[],
  phoneGrace: PhoneGrace,
  excusedSeqs: Set<number> = new Set(),
  absentSeqs: Set<number> = new Set(),
  outWindows: SecRange[] = [],
): SegmentScore {
  const occurrences: OccurrenceRow[] = [];
  // Attendance-absent segments are dropped from both sides — not a miss, not 100%.
  const scheduledSec = scheduled.reduce((a, s, i) => (
    absentSeqs.has(i + 1) ? a : a + Math.max(0, s.endSec - s.startSec)
  ), 0);
  const actualSec = actual.reduce((a, s, i) => {
    if (scheduled[i] && absentSeqs.has(i + 1)) return a;
    if (overlapsAny(s.startSec, s.endSec, outWindows)) return a;
    return a + s.durationSec;
  }, 0);
  let deviationSec = 0;
  let phoneExtraSec = 0;

  const label = kinds.missed === 'BREAK_MISSED' ? 'Break' : 'Lunch';
  // Phone spans are matched to the punch they OVERLAP (each used once), not by
  // position — an agent can have two punched breaks but only one phone-Break span,
  // and index pairing would then compare a morning punch to an afternoon phone.
  const phoneSorted = [...phone].sort((a, b) => a.startSec - b.startSec);
  const phoneUsed = phoneSorted.map(() => false);

  scheduled.forEach((sched, i) => {
    const seq = i + 1;
    const act = actual[i];
    const schedDur = Math.max(0, sched.endSec - sched.startSec);
    // An EXCUSED exception on this instance forgives the WHOLE segment — its
    // duration, start, a miss, AND the phone start/stop tied to it. If the break
    // itself is approved, the phone timing that hangs off that same punch is
    // approved with it, so it reads as fully adherent and adds no deviation.
    const excused = excusedSeqs.has(seq);
    if (absentSeqs.has(seq)) {
      // Not here — consume the paired punch/phone so they cannot attach to a
      // sibling, then record nothing.
      if (act) takeOverlappingPhone(act, phoneSorted, phoneUsed);
      return;
    }

    if (!act) {
      if (excused) return; // approved absence of this break/lunch — nothing scored
      const rule = missedRule(rules, kinds.missed, dateStr);
      deviationSec += schedDur;
      if (rule) {
        occurrences.push({
          user_id: userId, work_date: workDate, seq, rule_id: rule.id, kind: kinds.missed,
          deviation_seconds: 0,
          scheduled_start_sec: sched.startSec, scheduled_end_sec: sched.endSec,
          actual_start_sec: null, actual_end_sec: null,
          phone_start_sec: null, phone_end_sec: null,
          points: rule.points, reason_label: rule.label,
        });
      }
      return;
    }

    if (!excused) {
      // Duration: overage beyond the scheduled length. Returning early never earns
      // points (asymmetric), matching the proposal.
      const overage = Math.max(0, act.durationSec - schedDur);
      deviationSec += Math.abs(act.durationSec - schedDur);
      const durBand = matchBand(rules, kinds.duration, overage, dateStr);
      if (durBand) {
        occurrences.push({
          user_id: userId, work_date: workDate, seq, rule_id: durBand.id, kind: kinds.duration,
          deviation_seconds: overage,
          scheduled_start_sec: sched.startSec, scheduled_end_sec: sched.endSec,
          actual_start_sec: act.startSec, actual_end_sec: act.endSec,
          phone_start_sec: null, phone_end_sec: null,
          points: durBand.points,
          reason_label: `${durBand.label} (${formatDeviation(overage)} over)`,
        });
      }

      // Start-time: absolute offset from the scheduled start (early or late).
      const startDev = Math.abs(act.startSec - sched.startSec);
      const startBand = matchBand(rules, kinds.start, startDev, dateStr);
      if (startBand) {
        occurrences.push({
          user_id: userId, work_date: workDate, seq, rule_id: startBand.id, kind: kinds.start,
          deviation_seconds: startDev,
          scheduled_start_sec: sched.startSec, scheduled_end_sec: sched.endSec,
          actual_start_sec: act.startSec, actual_end_sec: act.endSec,
          phone_start_sec: null, phone_end_sec: null,
          points: startBand.points,
          reason_label: `${startBand.label} (${formatDeviation(startDev)} off)`,
        });
      }
    }

    // Punch ↔ Phone: the phone-Break span that overlaps THIS punch vs the punch.
    // Two independent edges, each with its own tolerance and its own band/row:
    //   START — phone opened Break/Meal before the clock-in (the dodge)
    //   STOP  — phone stayed Break/Meal after the clock-out (slow back on queue)
    // Compared to the PUNCH, never the plan. Always consume the overlapping span
    // (so it can't be matched to a sibling punch), but an EXCUSED segment scores
    // none of it — the exception forgives the phone with the break.
    const ph = takeOverlappingPhone(act, phoneSorted, phoneUsed);
    if (ph && !excused) {
      const earlyExtra = Math.max(0, act.startSec - ph.startSec);
      const lateExtra = Math.max(0, ph.endSec - act.endSec);
      phoneExtraSec += earlyExtra + lateExtra;

      const startDeviation = Math.max(0, earlyExtra - phoneGrace.beforeSec);
      const startBandPh = matchBand(rules, kinds.phoneStart, startDeviation, dateStr);
      if (startBandPh) {
        occurrences.push({
          user_id: userId, work_date: workDate, seq, rule_id: startBandPh.id, kind: kinds.phoneStart,
          deviation_seconds: startDeviation,
          scheduled_start_sec: null, scheduled_end_sec: null,
          actual_start_sec: act.startSec, actual_end_sec: act.endSec,
          phone_start_sec: ph.startSec, phone_end_sec: ph.endSec,
          points: startBandPh.points,
          reason_label: `${label} phone early on Break (${formatDeviation(startDeviation)} before punch)`,
        });
      }

      const stopDeviation = Math.max(0, lateExtra - phoneGrace.afterSec);
      const stopBandPh = matchBand(rules, kinds.phoneStop, stopDeviation, dateStr);
      if (stopBandPh) {
        occurrences.push({
          user_id: userId, work_date: workDate, seq, rule_id: stopBandPh.id, kind: kinds.phoneStop,
          deviation_seconds: stopDeviation,
          scheduled_start_sec: null, scheduled_end_sec: null,
          actual_start_sec: act.startSec, actual_end_sec: act.endSec,
          phone_start_sec: ph.startSec, phone_end_sec: ph.endSec,
          points: stopBandPh.points,
          reason_label: `${label} phone late off Break (${formatDeviation(stopDeviation)} after punch)`,
        });
      }
    }
  });

  return { occurrences, scheduledSec, actualSec, phoneExtraSec, deviationSec };
}

/**
 * Score one scheduled day. Returns null when the day carries no scheduled break
 * or lunch (nothing to measure), when a full-day attendance exception is on the
 * day, or when every remaining segment sits inside a windowed attendance
 * exception. Pure — numbers in, rows out — so the boundary behaviour is
 * unit-testable without a database.
 */
export function scoreDay(
  userId: number,
  dateStr: string,
  shiftId: number | null,
  scheduled: { breaks: ScheduledSeg[]; lunches: ScheduledSeg[] },
  actual: { breaks: ActualSeg[]; lunches: ActualSeg[] },
  phone: PhonePresence | null,
  rules: PointRule[],
  phoneGrace: PhoneGrace,
  excusals: DayExcusals = EMPTY_EXCUSALS,
  attendanceExceptions: PresenceException[] = [],
): { daily: DailyRow; occurrences: OccurrenceRow[] } | null {
  if (isFullDayAbsence(attendanceExceptions)) return null;
  if (scheduled.breaks.length === 0 && scheduled.lunches.length === 0) return null;

  const outWindows = absenceWindows(attendanceExceptions);
  const absentBreaks = absentScheduledSeqs(scheduled.breaks, outWindows);
  const absentLunches = absentScheduledSeqs(scheduled.lunches, outWindows);
  const countable =
    scheduled.breaks.filter((_, i) => !absentBreaks.has(i + 1)).length
    + scheduled.lunches.filter((_, i) => !absentLunches.has(i + 1)).length;
  if (countable === 0) return null;

  const workDate = dateOnlyValue(dateStr);
  const br = scoreSegment(
    userId, workDate, dateStr, BREAK_KINDS,
    scheduled.breaks, actual.breaks, phone?.breaks ?? [], rules, phoneGrace,
    excusals.breaks, absentBreaks, outWindows,
  );
  const lu = scoreSegment(
    userId, workDate, dateStr, LUNCH_KINDS,
    scheduled.lunches, actual.lunches, phone?.lunches ?? [], rules, phoneGrace,
    excusals.lunches, absentLunches, outWindows,
  );

  const scheduledTotal = br.scheduledSec + lu.scheduledSec;
  const deviationTotal = br.deviationSec + lu.deviationSec;
  const adherencePct =
    scheduledTotal > 0
      ? Math.round((Math.max(0, scheduledTotal - deviationTotal) / scheduledTotal) * 10000) / 100
      : null;

  const daily: DailyRow = {
    user_id: userId,
    work_date: workDate,
    shift_id: shiftId,
    break_scheduled_sec: br.scheduledSec,
    break_actual_sec: br.actualSec,
    lunch_scheduled_sec: lu.scheduledSec,
    lunch_actual_sec: lu.actualSec,
    phone_break_extra_sec: br.phoneExtraSec,
    phone_lunch_extra_sec: lu.phoneExtraSec,
    adherence_pct: adherencePct,
  };

  return { daily, occurrences: [...br.occurrences, ...lu.occurrences] };
}

/** Scheduled break (paid) and lunch (unpaid) instances from a scheduled day. */
function scheduledSegments(day: ScheduledDay): { breaks: ScheduledSeg[]; lunches: ScheduledSeg[] } {
  const breaks: ScheduledSeg[] = [];
  const lunches: ScheduledSeg[] = [];
  for (const seg of day.segments) {
    const startSec = secOfHm(seg.start);
    let endSec = secOfHm(seg.end);
    if (endSec < startSec) endSec += 24 * 3600;
    const target = seg.isPaid ? breaks : lunches;
    target.push({ startSec, endSec });
  }
  breaks.sort((a, b) => a.startSec - b.startSec);
  lunches.sort((a, b) => a.startSec - b.startSec);
  return { breaks, lunches };
}

// Recomputes are serialised — overlapping runs would interleave their deletes and
// inserts and leave a range half-scored.
let inFlight: Promise<unknown> = Promise.resolve();

/**
 * Rebuild adherence for a date range. Safe to call repeatedly — the range is
 * deleted and reinserted, so the result depends only on the current schedule,
 * punches, phone presence and rules. `userIds` omitted means everyone with a
 * published shift in the range.
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

function rangeScope(fromStr: string, toStr: string, explicitUserIds?: number[]) {
  return {
    work_date: { gte: dateOnlyValue(fromStr), lte: dateOnlyValue(toStr) },
    ...(explicitUserIds ? { user_id: { in: explicitUserIds } } : {}),
  };
}

async function wipeAdherenceRange(
  fromStr: string,
  toStr: string,
  explicitUserIds?: number[],
): Promise<void> {
  const scope = rangeScope(fromStr, toStr, explicitUserIds);
  await prisma.$transaction(async (tx) => {
    await tx.adherenceOccurrence.deleteMany({ where: scope });
    await tx.adherenceDaily.deleteMany({ where: scope });
  });
}

async function replaceAdherenceRange(
  fromStr: string,
  toStr: string,
  explicitUserIds: number[] | undefined,
  dailyRows: DailyRow[],
  occurrenceRows: OccurrenceRow[],
): Promise<void> {
  const scope = rangeScope(fromStr, toStr, explicitUserIds);
  await prisma.$transaction(async (tx) => {
    await tx.adherenceOccurrence.deleteMany({ where: scope });
    await tx.adherenceDaily.deleteMany({ where: scope });
    if (dailyRows.length > 0) await tx.adherenceDaily.createMany({ data: dailyRows });
    if (occurrenceRows.length > 0) await tx.adherenceOccurrence.createMany({ data: occurrenceRows });
  });
}

async function runRecompute(
  fromStr: string,
  toStr: string,
  explicitUserIds?: number[],
): Promise<RecomputeResult> {
  const start = await getAdherenceStartDate();
  if (fromStr < start) fromStr = start;

  const coverage = await getPunchCoverage();
  const effectiveTo = coverage.maxDate && coverage.maxDate < toStr ? coverage.maxDate : toStr;
  const empty: RecomputeResult = {
    from: fromStr, to: effectiveTo, daysScored: 0, occurrences: 0,
    skippedNoFeed: 0, skippedOutsideUserSpan: 0, usersWithoutPunchData: 0,
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

  const coveredUserIds = scheduledUserIds.filter((id) => coverage.byUser.has(id));
  const usersWithoutPunchData = scheduledUserIds.length - coveredUserIds.length;
  if (coveredUserIds.length === 0) return { ...empty, usersWithoutPunchData };

  const exemptIds = await getPunchExemptUserIds();
  const users = await prisma.user.findMany({
    where: { id: { in: coveredUserIds }, role_id: CSR_ROLE_ID },
    select: { id: true, is_active: true },
  });
  // Same "does not punch" gate as attendance — no daily/occurrence rows, so
  // threshold emails have nothing to fire on. Wipe leftover rows when the set
  // is empty so flipping the flag on is enough (no wait for the next import).
  const userIds = users.map((u) => u.id).filter((id) => !exemptIds.has(id));
  if (userIds.length === 0) {
    await wipeAdherenceRange(fromStr, effectiveTo, explicitUserIds);
    return { ...empty, usersWithoutPunchData };
  }

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
  const punchSegments = await getPunchSegments(windows);
  const phonePresence = await getPhonePresence(userIds, fromStr, effectiveTo);

  const rules = await loadPointRules();
  const phoneGrace = await getPhoneGrace();

  // EXCUSED adherence exceptions for the range, keyed 'userId:date' to match the
  // plan map, split by break/lunch and seq. Only excused rows reach scoring —
  // unexcused ones are recorded but forgive nothing. Consumed only here.
  const exceptionRows = await prisma.adherenceException.findMany({
    where: {
      work_date: { gte: dateOnlyValue(fromStr), lte: dateOnlyValue(effectiveTo) },
      user_id: { in: userIds },
      exception_type: { is_excused: true },
    },
    select: { user_id: true, work_date: true, segment_kind: true, seq: true },
  });
  const excusalsByDay = new Map<string, DayExcusals>();
  for (const r of exceptionRows) {
    const key = `${r.user_id}:${dateStrFromDate(r.work_date)}`;
    let de = excusalsByDay.get(key);
    if (!de) { de = { breaks: new Set(), lunches: new Set() }; excusalsByDay.set(key, de); }
    (r.segment_kind === 'BREAK' ? de.breaks : de.lunches).add(r.seq);
  }

  const dailyRows: DailyRow[] = [];
  const occurrenceRows: OccurrenceRow[] = [];
  let skippedNoFeed = 0;
  let skippedOutsideUserSpan = 0;

  for (const [k, day] of plan) {
    const [uidStr, dateStr] = k.split(':');
    if (dateStr < fromStr || dateStr > effectiveTo) continue;
    if (day.isDayOff) continue;

    if (!coverage.datesWithData.has(dateStr)) {
      skippedNoFeed++;
      continue;
    }

    const userId = Number(uidStr);
    const bounds = coverage.byUser.get(userId);
    if (!bounds) continue;
    if (dateStr < bounds.first || dateStr > (spanEnd.get(userId) ?? effectiveTo)) {
      skippedOutsideUserSpan++;
      continue;
    }

    const scheduled = scheduledSegments(day);
    const punch = punchSegments.get(k) ?? { breaks: [], lunches: [] };
    const actual = {
      breaks: punch.breaks.map((b) => ({ startSec: secOfDay(b.start), endSec: secOfDay(b.end), durationSec: b.durationSec })),
      lunches: punch.lunches.map((b) => ({ startSec: secOfDay(b.start), endSec: secOfDay(b.end), durationSec: b.durationSec })),
    };
    const phone = phonePresence.get(k) ?? null;
    const excusals = excusalsByDay.get(k) ?? EMPTY_EXCUSALS;

    const scored = scoreDay(
      userId, dateStr, day.shiftId, scheduled, actual, phone, rules, phoneGrace, excusals, day.exceptions,
    );
    if (!scored) continue;
    dailyRows.push(scored.daily);
    occurrenceRows.push(...scored.occurrences);
  }

  await replaceAdherenceRange(fromStr, effectiveTo, explicitUserIds, dailyRows, occurrenceRows);

  logger.info(
    `adherence recompute ${fromStr}..${effectiveTo}: ${dailyRows.length} days, ` +
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
