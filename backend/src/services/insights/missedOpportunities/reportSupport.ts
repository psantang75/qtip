import type { RowDataPacket } from 'mysql2';
import pool from '../../../config/database';
import { currentEmployeeJoin } from '../../insightsAgentScope';
import type { MissedOpportunityFilters, MissedOpportunityRunStatus } from './reportTypes';

/** Cap on rows returned to the page; a day of misses is far below this. */
export const MAX_FINDINGS = 1000;

export const toDateKey = (d: Date): number =>
  d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

export const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Local calendar date as 'YYYY-MM-DD'. `resolvePeriod` returns local Dates and
 * the primary pool is pinned to UTC, so handing a Date straight to the driver
 * would shift the day west of Greenwich — compare `run_date` as a string.
 */
export const fmtYMD = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmtMDY = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;

export const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * YYYY-MM-DD from a DATE column. The driver hands DATE back as a JS Date (no
 * `dateStrings`), and the primary pool is pinned to UTC, so the UTC calendar
 * date is the stored date.
 */
export const dateOnly = (v: unknown): string | null => isoDate(v)?.slice(0, 10) ?? null;

/**
 * Every predicate the report shares, bound to alias `f` (the finding) with
 * `e`/`dpt` available from EMP_JOINS. Identical scope semantics to
 * `insightsCollections.shared.viewerPredicates` — SELF pins the employee key on
 * the fact, DEPARTMENT pins the department on the joined employee row.
 */
export function buildScope(filters: MissedOpportunityFilters, fromKey: number, toKey: number) {
  const where = ['f.date_key BETWEEN ? AND ?'];
  const params: Array<string | number> = [fromKey, toKey];

  if (filters.users?.length) {
    where.push(`f.agent_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.ruleKeys?.length) {
    where.push(`f.rule_key IN (${filters.ruleKeys.map(() => '?').join(',')})`);
    params.push(...filters.ruleKeys);
  }
  if (filters.severities?.length) {
    where.push(`f.severity IN (${filters.severities.map(() => '?').join(',')})`);
    params.push(...filters.severities);
  }
  if (filters.selfEmployeeKey != null) {
    // The CURRENT row's key: the viewer's own key is current, while their older
    // findings carry superseded Type-2 keys and would drop out of their view.
    where.push('e.employee_key = ?');
    params.push(filters.selfEmployeeKey);
  }
  if (filters.departmentKeys?.length) {
    where.push(`e.department_key IN (${filters.departmentKeys.map(() => '?').join(',')})`);
    params.push(...filters.departmentKeys);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/**
 * Date + viewer-scope predicates only, deliberately ignoring the report's own
 * agent/rule/severity filters.
 *
 * The clean-call count has to sit on the same basis as `calls_analyzed`, which
 * is day-wide: narrowing the numerator by a rule filter while the denominator
 * stayed day-wide would report a clean rate that climbs every time someone
 * filters the page. Viewer scope still applies, because that is a permission
 * boundary rather than a display choice.
 */
export function buildRunScope(filters: MissedOpportunityFilters, fromKey: number, toKey: number) {
  const where = ['f.date_key BETWEEN ? AND ?'];
  const params: Array<string | number> = [fromKey, toKey];

  if (filters.selfEmployeeKey != null) {
    // The CURRENT row's key: the viewer's own key is current, while their older
    // findings carry superseded Type-2 keys and would drop out of their view.
    where.push('e.employee_key = ?');
    params.push(filters.selfEmployeeKey);
  }
  if (filters.departmentKeys?.length) {
    where.push(`e.department_key IN (${filters.departmentKeys.map(() => '?').join(',')})`);
    params.push(...filters.departmentKeys);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

export const EMP_JOINS = [
  currentEmployeeJoin({ left: true }),
  'LEFT JOIN ie_dim_department dpt ON dpt.department_key = e.department_key',
  'LEFT JOIN ie_missed_opportunity_rule r ON r.rule_key = f.rule_key',
].join('\n');

/**
 * The run row for a single day — what the admin re-grade polls to know when a
 * background run has finished (the run itself is async now, so the HTTP request
 * that starts it returns immediately). Null when the day was never graded.
 */
export async function getRunStatus(runDate: string): Promise<MissedOpportunityRunStatus | null> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT run_date, status, calls_considered, calls_analyzed, calls_failed,
            calls_skipped, findings_count, usd_cost, error_text, finished_at
       FROM ie_missed_opportunity_run
      WHERE run_date = ?
      LIMIT 1`,
    [runDate],
  );
  if (!row) return null;
  const n = (v: unknown) => (v == null ? 0 : Number(v));
  return {
    runDate: row.run_date ? new Date(row.run_date as string).toISOString().slice(0, 10) : runDate,
    status: (row.status as MissedOpportunityRunStatus['status']) ?? null,
    callsConsidered: n(row.calls_considered),
    callsAnalyzed: n(row.calls_analyzed),
    callsFailed: n(row.calls_failed),
    callsSkipped: n(row.calls_skipped),
    findingsCount: n(row.findings_count),
    usdCost: n(row.usd_cost),
    errorText: (row.error_text as string) ?? null,
    finishedAt: isoDate(row.finished_at),
  };
}
