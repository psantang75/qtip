/**
 * adherence.rollup.service — the read side. Raw SQL aggregates, matching how the
 * rest of Insights reads (attendance.rollup, QCKpiService); Prisma stays on the
 * engine's writes and config CRUD.
 *
 * Anchored to an `asOf` date, looking BACK 90 calendar days inclusive
 * [asOf - 89, asOf], floored to adherence_start_date. Two floors, deliberately
 * different:
 *   - OCCURRENCES + COMPLIANCE are always shown from the start date, so the
 *     report is useful during the report-only phase.
 *   - POINTS only count from adherence_points_active_from. Before that date the
 *     roster shows the behaviour and a zero point total, so flipping the switch
 *     later never surprises anyone.
 */
import pool from '../../config/database';
import { RowDataPacket } from 'mysql2';
import { deptClause } from '../insightsScope';
import { addDays } from '../scheduling/schedule.dates';
import { loadWarningThresholds } from './adherence.config';
import { resolveWarningLevel } from './adherence.rules';
import { getAdherenceStartDate, getPointsActiveFrom, floorFrom } from './adherence.settings';

const WINDOW_DAYS = 90;

export interface AdherenceWindow {
  asOf: string;
  from: string;
  pointsFrom: string;
  pointsActive: boolean;
}

/** The 90-day window ending on asOf, floored to the policy start, plus the
 * points-active floor for the same window. */
export async function windowForFloored(asOf: string): Promise<AdherenceWindow> {
  const [start, pointsActive] = await Promise.all([getAdherenceStartDate(), getPointsActiveFrom()]);
  const rawFrom = addDays(asOf, -(WINDOW_DAYS - 1));
  const from = floorFrom(rawFrom, start);
  return { asOf, from, pointsFrom: floorFrom(from, pointsActive), pointsActive: pointsActive <= asOf };
}

export function userNameClause(names: string[], alias = 'u'): { sql: string; params: string[] } {
  if (names.length === 0) return { sql: '', params: [] };
  return { sql: `AND ${alias}.username IN (${names.map(() => '?').join(',')})`, params: names };
}

export interface AgentAdherenceRow {
  userId: number;
  name: string;
  dept: string;
  points0to30: number;
  points31to60: number;
  points61to90: number;
  rolling90: number;
  /** Projected rolling-90 points by category, bucketed by age (days back from
   *  asOf) and summed over the whole window regardless of the points-active gate,
   *  so the report-only phase can show what is accumulating. Punch =
   *  duration/start/missed; Phone = phone start/stop. Total = sum of the three. */
  punchPoints0to30: number;
  punchPoints31to60: number;
  punchPoints61to90: number;
  punchPoints90: number;
  phonePoints0to30: number;
  phonePoints31to60: number;
  phonePoints61to90: number;
  phonePoints90: number;
  durationEvents: number;
  startEvents: number;
  missedEvents: number;
  /** Phone deviations split by edge (before the punch vs after). */
  phoneStartEvents: number;
  phoneStopEvents: number;
  phoneEvents: number;
  daysMeasured: number;
  scheduledSec: number;
  adherentSec: number;
  /** Actual punched break/lunch seconds and the phone off-queue overhang beyond
   *  the punch — the raw inputs behind phone/total adherence. */
  actualSec: number;
  phoneExtraSec: number;
  /** Gross punch overrun: the summed over-schedule seconds of every break/lunch
   *  that ran long (each segment independent — a short break never offsets a long
   *  one). Pairs with durationEvents as the "Punch Overage" detail. */
  punchOverrunSec: number;
  /** Punch = adherent/scheduled (schedule-vs-punch). Kept as compliancePct too for
   *  callers that predate the split. */
  compliancePct: number | null;
  /** Phone = punched/(punched+overhang): share of off-queue time inside the punch. */
  phoneAdherencePct: number | null;
  /** Total = adherent/(scheduled+overhang): one blend that both a bad punch and a
   *  phone overhang pull down. */
  totalAdherencePct: number | null;
  trend: number;
  trajectory: 'better' | 'worse' | 'flat';
  pointsActive: boolean;
  level: string | null;
  levelKey: string | null;
}

interface DailyAgg extends RowDataPacket {
  userId: number;
  name: string;
  dept: string;
  daysMeasured: number;
  scheduledSec: number;
  adherentSec: number;
  actualSec: number;
  phoneExtraSec: number;
  firstMeasured: Date | null;
  lastMeasured: Date | null;
}

interface OccAgg extends RowDataPacket {
  userId: number;
  b0: string | null;
  b31: string | null;
  b61: string | null;
  punchB0: string | null;
  punchB31: string | null;
  punchB61: string | null;
  phoneB0: string | null;
  phoneB31: string | null;
  phoneB61: string | null;
  durationEvents: number;
  startEvents: number;
  missedEvents: number;
  phoneStartEvents: number;
  phoneStopEvents: number;
  phoneEvents: number;
  punchOverrunSec: string | null;
}

const PUNCH_KINDS = "'BREAK_DURATION','LUNCH_DURATION','BREAK_START','LUNCH_START','BREAK_MISSED','LUNCH_MISSED'";
const PHONE_KINDS = "'BREAK_PHONE_START','BREAK_PHONE_STOP','LUNCH_PHONE_START','LUNCH_PHONE_STOP'";

/** DECIMAL columns arrive as strings; round to 2dp. */
const round2 = (v: string | null | undefined): number => Number(Number(v ?? 0).toFixed(2));
const round2sum = (...vs: Array<string | null | undefined>): number =>
  Number(vs.reduce((a, v) => a + Number(v ?? 0), 0).toFixed(2));

function spanDays(first: Date | null, last: Date | null): number {
  if (!first || !last) return 0;
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  return Math.min(WINDOW_DAYS, Math.max(0, days));
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
): Promise<AgentAdherenceRow[]> {
  const { from, pointsFrom, pointsActive } = await windowForFloored(asOf);
  const thresholds = await loadWarningThresholds();

  const dc = deptClause(deptFilter, 'u');
  const uc = userNameClause(userNames, 'u');
  const selfSql = selfUserId ? 'AND u.id = ?' : '';
  const selfParams = selfUserId ? [selfUserId] : [];
  const scope = [...dc.params, ...uc.params, ...selfParams];

  const [dailyRows] = await pool.execute<DailyAgg[]>(
    `SELECT u.id AS userId, u.username AS name,
            COALESCE(d.department_name, 'Unknown') AS dept,
            COUNT(*) AS daysMeasured,
            COALESCE(SUM(ad.break_scheduled_sec + ad.lunch_scheduled_sec), 0) AS scheduledSec,
            COALESCE(SUM((ad.break_scheduled_sec + ad.lunch_scheduled_sec) * COALESCE(ad.adherence_pct, 0) / 100), 0) AS adherentSec,
            COALESCE(SUM(ad.break_actual_sec + ad.lunch_actual_sec), 0) AS actualSec,
            COALESCE(SUM(ad.phone_break_extra_sec + ad.phone_lunch_extra_sec), 0) AS phoneExtraSec,
            MIN(ad.work_date) AS firstMeasured,
            MAX(ad.work_date) AS lastMeasured
       FROM adherence_daily ad
       JOIN users u ON u.id = ad.user_id
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE ad.work_date BETWEEN ? AND ?
        AND u.is_active = 1
        ${dc.sql} ${uc.sql} ${selfSql}
      GROUP BY u.id, u.username, dept`,
    [from, asOf, ...scope],
  );

  const [occRows] = await pool.execute<OccAgg[]>(
    `SELECT o.user_id AS userId,
            SUM(CASE WHEN o.work_date >= ? AND o.work_date >= ? THEN o.points ELSE 0 END) AS b0,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? AND o.work_date >= ? THEN o.points ELSE 0 END) AS b31,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? AND o.work_date >= ? THEN o.points ELSE 0 END) AS b61,
            SUM(CASE WHEN o.work_date >= ? AND o.kind IN (${PUNCH_KINDS}) THEN o.points ELSE 0 END) AS punchB0,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? AND o.kind IN (${PUNCH_KINDS}) THEN o.points ELSE 0 END) AS punchB31,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? AND o.kind IN (${PUNCH_KINDS}) THEN o.points ELSE 0 END) AS punchB61,
            SUM(CASE WHEN o.work_date >= ? AND o.kind IN (${PHONE_KINDS}) THEN o.points ELSE 0 END) AS phoneB0,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? AND o.kind IN (${PHONE_KINDS}) THEN o.points ELSE 0 END) AS phoneB31,
            SUM(CASE WHEN o.work_date BETWEEN ? AND ? AND o.kind IN (${PHONE_KINDS}) THEN o.points ELSE 0 END) AS phoneB61,
            SUM(o.kind IN ('BREAK_DURATION','LUNCH_DURATION')) AS durationEvents,
            SUM(o.kind IN ('BREAK_START','LUNCH_START')) AS startEvents,
            SUM(o.kind IN ('BREAK_MISSED','LUNCH_MISSED')) AS missedEvents,
            SUM(o.kind IN ('BREAK_PHONE_START','LUNCH_PHONE_START')) AS phoneStartEvents,
            SUM(o.kind IN ('BREAK_PHONE_STOP','LUNCH_PHONE_STOP')) AS phoneStopEvents,
            SUM(o.kind IN (${PHONE_KINDS})) AS phoneEvents,
            SUM(CASE WHEN o.kind IN ('BREAK_DURATION','LUNCH_DURATION') THEN o.deviation_seconds ELSE 0 END) AS punchOverrunSec
       FROM adherence_occurrence o
       JOIN users u ON u.id = o.user_id
      WHERE o.work_date BETWEEN ? AND ?
        AND u.is_active = 1
        ${dc.sql} ${uc.sql} ${selfSql}
      GROUP BY o.user_id`,
    [
      addDays(asOf, -29), pointsFrom,
      addDays(asOf, -59), addDays(asOf, -30), pointsFrom,
      from, addDays(asOf, -60), pointsFrom,
      addDays(asOf, -29),
      addDays(asOf, -59), addDays(asOf, -30),
      from, addDays(asOf, -60),
      addDays(asOf, -29),
      addDays(asOf, -59), addDays(asOf, -30),
      from, addDays(asOf, -60),
      from, asOf,
      ...scope,
    ],
  );

  const occByUser = new Map(occRows.map((r) => [r.userId, r]));

  return dailyRows.map((d) => {
    const o = occByUser.get(d.userId);
    const points0to30 = Number(o?.b0 ?? 0);
    const points31to60 = Number(o?.b31 ?? 0);
    const points61to90 = Number(o?.b61 ?? 0);
    const rolling90 = points0to30 + points31to60 + points61to90;

    const scheduledSec = Number(d.scheduledSec);
    const adherentSec = Math.round(Number(d.adherentSec));
    const actualSec = Math.round(Number(d.actualSec));
    const phoneExtraSec = Math.round(Number(d.phoneExtraSec));
    const coveredDays = spanDays(d.firstMeasured, d.lastMeasured);
    const trend = coveredDays > 0 ? rolling90 * (WINDOW_DAYS / coveredDays) : 0;
    const level = resolveWarningLevel(thresholds, rolling90, asOf);
    const delta = points0to30 - points61to90;

    return {
      userId: d.userId,
      name: d.name,
      dept: d.dept,
      points0to30,
      points31to60,
      points61to90,
      rolling90: Number(rolling90.toFixed(2)),
      punchPoints0to30: round2(o?.punchB0),
      punchPoints31to60: round2(o?.punchB31),
      punchPoints61to90: round2(o?.punchB61),
      punchPoints90: round2sum(o?.punchB0, o?.punchB31, o?.punchB61),
      phonePoints0to30: round2(o?.phoneB0),
      phonePoints31to60: round2(o?.phoneB31),
      phonePoints61to90: round2(o?.phoneB61),
      phonePoints90: round2sum(o?.phoneB0, o?.phoneB31, o?.phoneB61),
      durationEvents: Number(o?.durationEvents ?? 0),
      startEvents: Number(o?.startEvents ?? 0),
      missedEvents: Number(o?.missedEvents ?? 0),
      phoneStartEvents: Number(o?.phoneStartEvents ?? 0),
      phoneStopEvents: Number(o?.phoneStopEvents ?? 0),
      phoneEvents: Number(o?.phoneEvents ?? 0),
      daysMeasured: Number(d.daysMeasured),
      scheduledSec,
      adherentSec,
      actualSec,
      phoneExtraSec,
      punchOverrunSec: Number(o?.punchOverrunSec ?? 0),
      compliancePct: scheduledSec > 0 ? (adherentSec / scheduledSec) * 100 : null,
      phoneAdherencePct: actualSec + phoneExtraSec > 0 ? (actualSec / (actualSec + phoneExtraSec)) * 100 : null,
      totalAdherencePct: scheduledSec + phoneExtraSec > 0 ? (adherentSec / (scheduledSec + phoneExtraSec)) * 100 : null,
      trend: Number(trend.toFixed(2)),
      trajectory: delta > 0 ? 'worse' : delta < 0 ? 'better' : 'flat',
      pointsActive,
      level: level?.label ?? null,
      levelKey: level?.levelKey ?? null,
    };
  });
}

/** DATE / DATETIME from MySQL → 'YYYY-MM-DD' / 'HH:MM'. */
function toDateStr(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function bandLabel(reasonLabel: string): string {
  return reasonLabel.replace(/\s*\([^)]*\)\s*$/, '');
}

/** Seconds since local midnight → 'HH:MM' (24h, wrapped for overnight shifts), or
 *  null when the time does not apply to this occurrence kind. */
function secToHm(sec: number | null): string | null {
  if (sec === null || sec === undefined) return null;
  const s = ((sec % 86_400) + 86_400) % 86_400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface AdherenceOccurrenceDetail {
  workDate: string;
  seq: number;
  kind: string;
  reason: string;
  deviationSeconds: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  phoneStart: string | null;
  phoneEnd: string | null;
  points: number;
  counted: boolean;
}

/** Filter options for the Agent/Department dropdowns, department-scoped. */
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
       FROM adherence_daily ad
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

/** Drill-down for one agent. `counted` marks whether the point actually applied
 * (only true on/after the points-active date), so the report can show a phone
 * occurrence during the report-only phase as behaviour without a live point. */
export async function getOccurrences(userId: number, asOf: string): Promise<AdherenceOccurrenceDetail[]> {
  const { from, pointsFrom } = await windowForFloored(asOf);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.work_date, o.seq, o.kind, o.reason_label, o.deviation_seconds,
            o.scheduled_start_sec, o.scheduled_end_sec,
            o.actual_start_sec, o.actual_end_sec,
            o.phone_start_sec, o.phone_end_sec, o.points
       FROM adherence_occurrence o
      WHERE o.user_id = ? AND o.work_date BETWEEN ? AND ?
      ORDER BY o.work_date DESC, o.seq, o.kind`,
    [userId, from, asOf],
  );
  const toSec = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({
    workDate: toDateStr(r.work_date),
    seq: Number(r.seq),
    kind: r.kind as string,
    reason: bandLabel(r.reason_label as string),
    deviationSeconds: Number(r.deviation_seconds),
    scheduledStart: secToHm(toSec(r.scheduled_start_sec)),
    scheduledEnd: secToHm(toSec(r.scheduled_end_sec)),
    actualStart: secToHm(toSec(r.actual_start_sec)),
    actualEnd: secToHm(toSec(r.actual_end_sec)),
    phoneStart: secToHm(toSec(r.phone_start_sec)),
    phoneEnd: secToHm(toSec(r.phone_end_sec)),
    points: Number(r.points),
    counted: toDateStr(r.work_date) >= pointsFrom,
  }));
}
