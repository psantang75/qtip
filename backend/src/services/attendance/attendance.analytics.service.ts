/**
 * attendance.analytics.service — the two sections that need their own shape:
 * the person-by-month compliance matrix and the weekday pattern.
 *
 * Compliance deliberately stays on CALENDAR MONTHS while points use 30-day
 * buckets. Points are a rolling-90 policy, so buckets mirror the policy;
 * compliance is a trend over time, where months are the natural axis and match
 * the report already run by hand.
 *
 * Excused days are excluded from BOTH sides of the ratio, so a month of approved
 * leave reads as no data rather than as zero percent.
 */
import pool from '../../config/database';
import { RowDataPacket } from 'mysql2';
import { deptClause } from '../insightsScope';
import { userNameClause } from './attendance.rollup.service';

export interface ComplianceCell {
  month: string;
  scheduledMinutes: number;
  adherentMinutes: number;
  pct: number | null;
}

export interface ComplianceRow {
  userId: number;
  name: string;
  dept: string;
  cells: ComplianceCell[];
  totalScheduled: number;
  totalAdherent: number;
  totalPct: number | null;
}

export interface ComplianceMatrix {
  months: string[];
  rows: ComplianceRow[];
  columnTotals: ComplianceCell[];
  grandTotalPct: number | null;
}

/** First day of the month, n months before the month containing dateStr. */
function monthKey(dateStr: string, offset: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Person-by-month compliance. `monthsBack` counts the month containing asOf, so
 * 6 means the current month plus the five before it.
 */
export async function getComplianceMatrix(
  deptFilter: number[],
  asOf: string,
  selfUserId?: number,
  monthsBack = 6,
  userNames: string[] = [],
): Promise<ComplianceMatrix> {
  const months: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) months.push(monthKey(asOf, -i));
  const from = `${months[0]}-01`;

  const dc = deptClause(deptFilter, 'u');
  const uc = userNameClause(userNames, 'u');
  const selfSql = selfUserId ? 'AND u.id = ?' : '';
  const selfParams = selfUserId ? [selfUserId] : [];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id AS userId, u.username AS name,
            COALESCE(d.department_name, 'Unknown') AS dept,
            DATE_FORMAT(ad.work_date, '%Y-%m') AS ym,
            SUM(ad.scheduled_minutes) AS sched,
            SUM(ad.adherent_minutes) AS adher
       FROM attendance_daily ad
       JOIN users u ON u.id = ad.user_id
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE ad.work_date >= ? AND ad.work_date <= ?
        AND ad.is_excused = 0
        AND u.is_active = 1
        ${dc.sql} ${uc.sql} ${selfSql}
      GROUP BY u.id, u.username, dept, ym`,
    [from, asOf, ...dc.params, ...uc.params, ...selfParams],
  );

  const byUser = new Map<number, ComplianceRow>();
  for (const r of rows) {
    const userId = Number(r.userId);
    let row = byUser.get(userId);
    if (!row) {
      row = {
        userId,
        name: r.name as string,
        dept: r.dept as string,
        cells: months.map((month) => ({ month, scheduledMinutes: 0, adherentMinutes: 0, pct: null })),
        totalScheduled: 0,
        totalAdherent: 0,
        totalPct: null,
      };
      byUser.set(userId, row);
    }
    const idx = months.indexOf(r.ym as string);
    if (idx === -1) continue;
    const sched = Number(r.sched);
    const adher = Number(r.adher);
    row.cells[idx] = { month: r.ym as string, scheduledMinutes: sched, adherentMinutes: adher, pct: pct(adher, sched) };
    row.totalScheduled += sched;
    row.totalAdherent += adher;
  }

  const out = [...byUser.values()].map((r) => ({ ...r, totalPct: pct(r.totalAdherent, r.totalScheduled) }));
  out.sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));

  const columnTotals: ComplianceCell[] = months.map((month, i) => {
    const sched = out.reduce((s, r) => s + r.cells[i].scheduledMinutes, 0);
    const adher = out.reduce((s, r) => s + r.cells[i].adherentMinutes, 0);
    return { month, scheduledMinutes: sched, adherentMinutes: adher, pct: pct(adher, sched) };
  });

  const grandSched = out.reduce((s, r) => s + r.totalScheduled, 0);
  const grandAdher = out.reduce((s, r) => s + r.totalAdherent, 0);

  return { months, rows: out, columnTotals, grandTotalPct: pct(grandAdher, grandSched) };
}

function pct(adherent: number, scheduled: number): number | null {
  return scheduled > 0 ? (adherent / scheduled) * 100 : null;
}

export interface DayOfWeekRow {
  dayOfWeek: number;
  label: string;
  absences: number;
  lates: number;
  scheduledDays: number;
}

const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Absences and late arrivals by weekday over the rolling window. The classic
 * attendance-abuse signal: Monday and Friday clustering is exactly what a
 * workforce manager looks for, and it is meaningless without the scheduled-day
 * denominator, because nobody is scheduled evenly across seven days.
 */
export async function getDayOfWeek(
  deptFilter: number[],
  from: string,
  asOf: string,
  selfUserId?: number,
  userNames: string[] = [],
): Promise<DayOfWeekRow[]> {
  const dc = deptClause(deptFilter, 'u');
  const uc = userNameClause(userNames, 'u');
  const selfSql = selfUserId ? 'AND u.id = ?' : '';
  const selfParams = selfUserId ? [selfUserId] : [];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DAYOFWEEK(ad.work_date) - 1 AS dow,
            COUNT(*) AS scheduledDays,
            SUM(ad.is_absent) AS absences,
            SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM attendance_occurrence o
                   WHERE o.user_id = ad.user_id AND o.work_date = ad.work_date AND o.kind = 'LATE'
                ) THEN 1 ELSE 0 END) AS lates
       FROM attendance_daily ad
       JOIN users u ON u.id = ad.user_id
      WHERE ad.work_date BETWEEN ? AND ?
        AND u.is_active = 1
        ${dc.sql} ${uc.sql} ${selfSql}
      GROUP BY dow`,
    [from, asOf, ...dc.params, ...uc.params, ...selfParams],
  );

  const byDow = new Map(rows.map((r) => [Number(r.dow), r]));
  return DOW_LABELS.map((label, dow) => {
    const r = byDow.get(dow);
    return {
      dayOfWeek: dow,
      label,
      absences: Number(r?.absences ?? 0),
      lates: Number(r?.lates ?? 0),
      scheduledDays: Number(r?.scheduledDays ?? 0),
    };
  }).filter((r) => r.scheduledDays > 0);
}
