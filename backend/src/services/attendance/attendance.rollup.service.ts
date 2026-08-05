/**
 * attendance.rollup.service — the read side. Raw SQL aggregates, matching how
 * every other Insights report reads (QCKpiService et al); Prisma is used for the
 * engine's writes and the config CRUD.
 *
 * Everything is anchored to an `asOf` date and looks BACK 90 calendar days,
 * inclusive: [asOf - 89, asOf]. The three display buckets (0-30 / 31-60 / 61-90)
 * partition that window exactly, which is why the roster has no separate Total
 * column — the buckets sum to Rolling 90 and a fourth number would just be a
 * chance to disagree.
 *
 * Points are summed in SQL as DECIMAL, never accumulated as JS floats: today's
 * bands are all quarter-points and safe, but an admin can enter anything.
 */
import pool from '../../config/database';
import { RowDataPacket } from 'mysql2';
import { deptClause } from '../insightsScope';
import { addDays } from '../scheduling/schedule.dates';
import { loadPointRules, loadWarningThresholds } from './attendance.config';
import { bandsFor, resolveWarningLevel } from './attendance.rules';
import { getPointsStartDate, floorFrom } from './attendance.settings';

/** The policy window. Ninety CALENDAR days, matching how the policy is written. */
const WINDOW_DAYS = 90;

export interface AttendanceWindow {
  asOf: string;
  from: string;
}

/** The 90-day window ending on asOf, inclusive on both ends. */
export function windowFor(asOf: string): AttendanceWindow {
  return { asOf, from: addDays(asOf, -(WINDOW_DAYS - 1)) };
}

/**
 * The 90-day window with its lower bound raised to the policy start date. Every
 * read goes through here so days before the policy existed are never counted,
 * even when the rolling window still reaches back past the start date. The engine
 * likewise refuses to score before the start, so the two sides agree.
 */
export async function windowForFloored(asOf: string): Promise<AttendanceWindow> {
  const start = await getPointsStartDate();
  const { from } = windowFor(asOf);
  return { asOf, from: floorFrom(from, start) };
}

/**
 * The Agent dropdown in the filter bar sends usernames. Empty means no restriction.
 * Shared by all three attendance reads so the filter behaves identically on each.
 */
export function userNameClause(names: string[], alias = 'u'): { sql: string; params: string[] } {
  if (names.length === 0) return { sql: '', params: [] };
  return { sql: `AND ${alias}.username IN (${names.map(() => '?').join(',')})`, params: names };
}

/** Inclusive day count between two DATE values, capped at the window length. */
function spanDays(first: Date | null, last: Date | null): number {
  if (!first || !last) return 0;
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  return Math.min(WINDOW_DAYS, Math.max(0, days));
}

export interface AgentAttendanceRow {
  userId: number;
  name: string;
  dept: string;
  points0to30: number;
  points31to60: number;
  points61to90: number;
  rolling90: number;
  absences: number;
  lates: number;
  earlyLeaves: number;
  graceUsed: number;
  daysMeasured: number;
  scheduledMinutes: number;
  adherentMinutes: number;
  compliancePct: number | null;
  trend: number;
  trendBasisDays: number;
  trendTargetDays: number;
  trajectory: 'better' | 'worse' | 'flat';
  rollOffDate: string | null;
  rollOffPoints: number;
  rollOffTotal: number;
  level: string | null;
  levelKey: string | null;
}

interface DailyAgg extends RowDataPacket {
  userId: number;
  name: string;
  dept: string;
  daysMeasured: number;
  scheduledMinutes: number;
  adherentMinutes: number;
  graceUsed: number;
  firstMeasured: Date | null;
  lastMeasured: Date | null;
}

interface PointAgg extends RowDataPacket {
  userId: number;
  b0: string | null;
  b31: string | null;
  b61: string | null;
  absences: number;
  lates: number;
  earlyLeaves: number;
}

interface RollOffAgg extends RowDataPacket {
  userId: number;
  earliest: Date;
  points: string;
}

/**
 * The grace ceiling in seconds: one below the lowest LATE band. Days at or under
 * it earn nothing but are still counted, which is the entire point of tracking
 * grace usage — a pure point system cannot see the person who is 2:59 late every
 * single day.
 */
function graceCeiling(asOf: string, rules: Awaited<ReturnType<typeof loadPointRules>>): number {
  const bands = bandsFor(rules, 'LATE', asOf);
  return bands.length > 0 ? bands[0].minSeconds - 1 : 0;
}

/**
 * One row per measured agent. `deptFilter` comes from resolveDeptFilter;
 * `selfUserId` restricts to a single person for SELF-scoped viewers.
 */
export async function getAgentRows(
  deptFilter: number[],
  asOf: string,
  selfUserId?: number,
  userNames: string[] = [],
): Promise<AgentAttendanceRow[]> {
  const { from } = await windowForFloored(asOf);
  const rules = await loadPointRules();
  const thresholds = await loadWarningThresholds();
  const grace = graceCeiling(asOf, rules);

  const dc = deptClause(deptFilter, 'u');
  const uc = userNameClause(userNames, 'u');
  const selfSql = selfUserId ? 'AND u.id = ?' : '';
  const selfParams = selfUserId ? [selfUserId] : [];

  const [dailyRows] = await pool.execute<DailyAgg[]>(
    `SELECT u.id AS userId, u.username AS name,
            COALESCE(d.department_name, 'Unknown') AS dept,
            COUNT(*) AS daysMeasured,
            COALESCE(SUM(CASE WHEN ad.is_excused = 0 THEN ad.scheduled_minutes END), 0) AS scheduledMinutes,
            COALESCE(SUM(CASE WHEN ad.is_excused = 0 THEN ad.adherent_minutes END), 0) AS adherentMinutes,
            SUM(ad.late_seconds BETWEEN 1 AND ?) AS graceUsed,
            MIN(ad.work_date) AS firstMeasured,
            MAX(ad.work_date) AS lastMeasured
       FROM attendance_daily ad
       JOIN users u ON u.id = ad.user_id
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE ad.work_date BETWEEN ? AND ?
        AND u.is_active = 1
        ${dc.sql} ${uc.sql} ${selfSql}
      GROUP BY u.id, u.username, dept`,
    [grace, from, asOf, ...dc.params, ...uc.params, ...selfParams],
  );

  const [pointRows] = await pool.execute<PointAgg[]>(
    `SELECT o.user_id AS userId,
            SUM(CASE WHEN o.work_date >= ? THEN o.points ELSE 0 END) AS b0,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? THEN o.points ELSE 0 END) AS b31,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? THEN o.points ELSE 0 END) AS b61,
            SUM(o.kind = 'ABSENT') AS absences,
            SUM(o.kind = 'LATE') AS lates,
            SUM(o.kind = 'EARLY_LEAVE') AS earlyLeaves
       FROM attendance_occurrence o
       JOIN users u ON u.id = o.user_id
      WHERE o.work_date BETWEEN ? AND ?
        AND u.is_active = 1
        ${dc.sql} ${uc.sql} ${selfSql}
      GROUP BY o.user_id`,
    [
      addDays(asOf, -29),
      addDays(asOf, -59), addDays(asOf, -30),
      from, addDays(asOf, -60),
      from, asOf,
      ...dc.params, ...uc.params, ...selfParams,
    ],
  );

  // Roll-off: the oldest points still inside the window, and the date they leave
  // it. Unique to a rolling window, and the guard against issuing a Written
  // warning against points that expire two days later.
  const [rollOffRows] = await pool.execute<RollOffAgg[]>(
    `SELECT t.user_id AS userId, t.earliest, SUM(o.points) AS points
       FROM (SELECT user_id, MIN(work_date) AS earliest
               FROM attendance_occurrence
              WHERE work_date BETWEEN ? AND ?
              GROUP BY user_id) t
       JOIN attendance_occurrence o
         ON o.user_id = t.user_id AND o.work_date = t.earliest
      GROUP BY t.user_id, t.earliest`,
    [from, asOf],
  );

  const pointsByUser = new Map(pointRows.map((r) => [r.userId, r]));
  const rollOffByUser = new Map(rollOffRows.map((r) => [r.userId, r]));

  return dailyRows.map((d) => {
    const p = pointsByUser.get(d.userId);
    const points0to30 = Number(p?.b0 ?? 0);
    const points31to60 = Number(p?.b31 ?? 0);
    const points61to90 = Number(p?.b61 ?? 0);
    const rolling90 = points0to30 + points31to60 + points61to90;

    const daysMeasured = Number(d.daysMeasured);
    const scheduledMinutes = Number(d.scheduledMinutes);
    const adherentMinutes = Number(d.adherentMinutes);

    // Coverage is measured as the CALENDAR SPAN the person was observable over,
    // not as a count of scheduled days. Counting scheduled days conflates a
    // part-time schedule with missing data: somebody working three days a week
    // would show two thirds coverage forever and their pace would be inflated by
    // half permanently. Span-based coverage gives a part-timer with full history a
    // trend equal to their Rolling 90, which is the truth.
    const coveredDays = spanDays(d.firstMeasured, d.lastMeasured);
    const trend = coveredDays > 0 ? rolling90 * (WINDOW_DAYS / coveredDays) : 0;

    const level = resolveWarningLevel(thresholds, rolling90, asOf);
    const roll = rollOffByUser.get(d.userId);
    const rollOffPoints = Number(roll?.points ?? 0);

    const delta = points0to30 - points61to90;
    return {
      userId: d.userId,
      name: d.name,
      dept: d.dept,
      points0to30,
      points31to60,
      points61to90,
      rolling90: Number(rolling90.toFixed(2)),
      absences: Number(p?.absences ?? 0),
      lates: Number(p?.lates ?? 0),
      earlyLeaves: Number(p?.earlyLeaves ?? 0),
      graceUsed: Number(d.graceUsed ?? 0),
      daysMeasured,
      scheduledMinutes,
      adherentMinutes,
      compliancePct: scheduledMinutes > 0 ? (adherentMinutes / scheduledMinutes) * 100 : null,
      trend: Number(trend.toFixed(2)),
      trendBasisDays: coveredDays,
      trendTargetDays: WINDOW_DAYS,
      trajectory: delta > 0 ? 'worse' : delta < 0 ? 'better' : 'flat',
      rollOffDate: roll ? addDays(toDateStr(roll.earliest), 90) : null,
      rollOffPoints,
      rollOffTotal: Number((rolling90 - rollOffPoints).toFixed(2)),
      level: level?.label ?? null,
      levelKey: level?.levelKey ?? null,
    };
  });
}

/** MySQL DATE comes back as a Date at UTC midnight. */
function toDateStr(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Options for the filter bar's Agent and Department dropdowns. Deliberately NOT
 * derived from the returned rows: selecting an agent would then shrink the very
 * list you selected from, and there would be no way back. Honours department scope
 * (so a manager never sees names outside their scope) but ignores the agent filter.
 */
export async function getFilterOptions(
  deptFilter: number[],
  asOf: string,
  selfUserId?: number,
): Promise<{ availableUsers: string[]; availableDepartments: string[] }> {
  const { from } = await windowForFloored(asOf);
  const dc = deptClause(deptFilter, 'u');
  const selfSql = selfUserId ? 'AND u.id = ?' : '';
  const selfParams = selfUserId ? [selfUserId] : [];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT u.username AS name, COALESCE(d.department_name, 'Unknown') AS dept
       FROM attendance_daily ad
       JOIN users u ON u.id = ad.user_id
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE ad.work_date BETWEEN ? AND ?
        AND u.is_active = 1
        ${dc.sql} ${selfSql}`,
    [from, asOf, ...dc.params, ...selfParams],
  );

  return {
    availableUsers: [...new Set(rows.map((r) => r.name as string))].sort(),
    availableDepartments: [...new Set(rows.map((r) => r.dept as string))].sort(),
  };
}

export interface OccurrenceDetail {
  workDate: string;
  kind: string;
  reason: string;
  deviationSeconds: number;
  points: number;
  /** Scheduled shift window as 'HH:MM', null on a day with no shift times. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Actual arrival and departure as 'HH:MM'. Null on an absence. */
  punchIn: string | null;
  punchOut: string | null;
}

/** 'HH:MM' from a DATETIME, or null. Wall clock — no timezone conversion. */
function hhmm(value: Date | null): string | null {
  if (!value) return null;
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

/**
 * A band label without the deviation baked into it. `reason_label` is stored as
 * "Late 3+ (0:10:00)" so the row can explain itself even if the rule is later
 * deleted, but the detail table shows the deviation in its own column and would
 * otherwise print it twice.
 */
function bandLabel(reasonLabel: string): string {
  return reasonLabel.replace(/\s*\([^)]*\)\s*$/, '');
}

/**
 * Drill-down for one agent, lazily fetched when their row expands.
 *
 * Joined to attendance_daily and the shift so each row can show the schedule it
 * was measured against beside the punches themselves. Showing "Late 3+ 0:10:00"
 * with no sight of the 09:00 shift and the 09:10 punch asks the manager to take
 * the number on faith, which is the wrong posture for a figure someone may be
 * disciplined over.
 */
export async function getOccurrences(userId: number, asOf: string): Promise<OccurrenceDetail[]> {
  const { from } = await windowForFloored(asOf);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.work_date, o.kind, o.reason_label, o.deviation_seconds, o.points,
            s.start_at AS sched_start, s.end_at AS sched_end,
            ad.first_punch_at, ad.last_punch_at
       FROM attendance_occurrence o
       LEFT JOIN attendance_daily ad
              ON ad.user_id = o.user_id AND ad.work_date = o.work_date
       LEFT JOIN schedule_shift s ON s.id = ad.shift_id
      WHERE o.user_id = ? AND o.work_date BETWEEN ? AND ?
      ORDER BY o.work_date DESC`,
    [userId, from, asOf],
  );
  return rows.map((r) => ({
    workDate: toDateStr(r.work_date),
    kind: r.kind as string,
    reason: bandLabel(r.reason_label as string),
    deviationSeconds: Number(r.deviation_seconds),
    points: Number(r.points),
    scheduledStart: hhmm(r.sched_start as Date | null),
    scheduledEnd: hhmm(r.sched_end as Date | null),
    punchIn: hhmm(r.first_punch_at as Date | null),
    punchOut: hhmm(r.last_punch_at as Date | null),
  }));
}
