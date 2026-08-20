/**
 * Insights — Agent Activity read service.
 *
 * Phase 2 data layer for the "Agent Activity - Sales" section. Reads the
 * partitioned ie_fact_* tables populated by the source-report ingestion
 * dispatcher and returns shapes the AA report pages consume.
 *
 * Phase 0 (foundation) ships the registry/status surface only; per-report
 * query methods are added one phase at a time (email -> call -> tickets ->
 * leads -> margin) as each fact table comes online. `factTableExists` lets
 * those methods degrade gracefully to empty results before their fact table
 * has been created/loaded, so the UI never errors on a not-yet-built report.
 */
import mysql from 'mysql2/promise';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { resolvePeriod, type DateRange } from '../utils/periodUtils';
import { crmDatabaseConfig } from '../config/environment';
import {
  buildSystemNoteExclusionSql,
  systemExclusionEnabled,
  TOUCHED_EXCLUDE_SYSTEM_FLAG,
} from './insights/systemNoteClassifier';

/** Direction that counts as a "sent" email on the Email Activity report. */
const SENT_DIRECTION = 'Outbound';

/**
 * Agent Activity reports are sales-only. Two always-on guards, regardless of
 * what the fact table contains:
 *   1. CSR role only — never surface admin/manager/qa/trainer or unmatched mailboxes.
 *   2. Sales department subtree only — the employee's department must roll up
 *      under "Sales Department - All" (so CSRs in Customer Service / Tech
 *      Support / etc. are excluded). Matched via ie_dim_department.hierarchy_path.
 */
const AGENT_ROLE = 'CSR';
const SALES_DEPT_ROOT_PATH = '/Sales Department - All';

/**
 * Apply a SELF data-scope restriction to a report's BASE predicate. When a
 * salesperson (CSR) is granted a page with data_scope='SELF', the controller
 * passes their conformed `employee_key` here so every query — the data tables
 * AND the filter dropdowns — is limited to that one employee. Injected into the
 * base (not the layered) predicate so the user can never widen past themselves.
 * No-op for ALL scope (selfEmployeeKey == null), leaving admin/manager views
 * unchanged. Every AA fact table conforms on `f.employee_key`, so this is the
 * single uniform hook across all five reports.
 */
function applySelfScope(
  baseWhere: string[],
  baseParams: (string | number)[],
  selfEmployeeKey?: number | null,
): void {
  if (selfEmployeeKey != null) {
    baseWhere.push('f.employee_key = ?');
    baseParams.push(selfEmployeeKey);
  }
}

export interface SourceReportStatus {
  report_code: string;
  report_name: string;
  load_mode: string;
  frequency_minutes: number;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  target_fact_table: string;
}

/** True if a table exists in the current schema (used to guard reads on not-yet-built facts). */
export async function factTableExists(tableName: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName],
  );
  return rows.length > 0;
}

/** List registered source reports + their scheduling/run status. Empty until reports are seeded. */
export async function listSourceReports(): Promise<SourceReportStatus[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT report_code, report_name, load_mode, frequency_minutes, is_active,
            last_run_at, next_run_at, last_status, target_fact_table
     FROM ie_source_report
     ORDER BY report_name`,
  );

  return rows.map((r) => ({
    report_code: r.report_code,
    report_name: r.report_name,
    load_mode: r.load_mode,
    frequency_minutes: Number(r.frequency_minutes),
    is_active: !!r.is_active,
    last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    next_run_at: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
    last_status: r.last_status ?? null,
    target_fact_table: r.target_fact_table,
  }));
}

/**
 * Convert a DATETIME value read from MySQL into a true ISO-8601 UTC string the
 * frontend can localize. The primary pool is pinned to UTC (mysql2 `timezone: 'Z'`
 * + a per-connection `SET time_zone = '+00:00'`; see config/database.ts), so
 * NOW()/CURRENT_TIMESTAMP are written as UTC and mysql2 parses DATETIME columns
 * into JS Date objects as UTC — independent of the host/Node timezone. That makes
 * `.toISOString()` yield the correct instant in every environment. Do NOT format
 * these in SQL with a literal 'Z' (e.g. DATE_FORMAT(..,'..Z')) — that mislabels a
 * wall-clock string as UTC and the frontend shifts it by the offset (the old
 * ~4h-off "Data last updated" bug).
 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Scheduling info for a report, used to power the freshness stamp and its
 * "next update" tooltip. All three timestamps come straight from the report's
 * `ie_source_report` row so the report header matches the Source Reports
 * scheduler exactly:
 *   - `dataLastUpdated` = `last_run_at` — the last time the schedule ran (i.e.
 *     the last time the data was updated, or attempted to be). This is the
 *     single source of truth users see in both places; it does NOT depend on
 *     whether the run happened to write new rows.
 *   - `dataNextUpdate`  = `next_run_at`.
 * Both are emitted as ISO-8601 UTC so the frontend converts to local time
 * identically. Null-safe: returns nulls if the report isn't registered.
 */
export interface ReportSchedule {
  dataLastUpdated: string | null;
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

export async function getReportSchedule(reportCode: string): Promise<ReportSchedule> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT frequency_minutes, last_run_at AS lastRun, next_run_at AS nextRun
     FROM ie_source_report WHERE report_code = ? AND is_active = 1 LIMIT 1`,
    [reportCode],
  );
  const r = rows[0];
  return {
    dataLastUpdated: toIso(r?.lastRun),
    dataNextUpdate: toIso(r?.nextRun),
    updateEveryMinutes: r ? Number(r.frequency_minutes) : null,
  };
}

// ── Email Activity (Phase 1) ────────────────────────────────────────────────

export interface EmailActivityFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  /** Agent display names (ie_fact_email_activity.mailbox_name). */
  users?: string[];
  /** Department names (ie_dim_department.department_name). */
  departments?: string[];
  /**
   * When set (SELF data-scope), restrict every query — data AND dropdowns — to
   * this single conformed employee so a salesperson only ever sees their own
   * numbers. Resolved from ie_page_role_access via InsightsPermissionService.
   */
  selfEmployeeKey?: number | null;
}

export interface EmailSummaryRow { agent: string; department: string; totalSent: number; }
export interface EmailByDayRow { agent: string; date: string; totalSent: number; }
export interface EmailByDayGroup { agent: string; department: string; rows: EmailByDayRow[]; total: { totalSent: number }; }

export interface EmailActivityResult {
  summary: EmailSummaryRow[];
  summaryTotal: EmailSummaryRow;
  byDay: EmailByDayGroup[];
  availableUsers: string[];
  availableDepartments: string[];
  dataLastUpdated: string | null;
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

/** YYYYMMDD integer matching ie_dim_date.date_key. */
function toDateKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * The natural (calendar) end of a period, used as the pace projection target.
 * resolvePeriod caps in-progress periods at today; this restores the full-period
 * end (month/quarter/week/year) so pace can project month-to-date figures to
 * period-end. Completed periods (prior or custom) already carry their natural end.
 */
function periodNaturalEnd(period: string, start: Date, rangeEnd: Date): Date {
  switch (period.toLowerCase().replace(/\s+/g, '_')) {
    case 'current_month':   return new Date(start.getFullYear(), start.getMonth() + 1, 0);
    case 'current_quarter': return new Date(start.getFullYear(), start.getMonth() + 3, 0);
    case 'current_year':    return new Date(start.getFullYear(), 11, 31);
    case 'current_week':    { const e = new Date(start); e.setDate(e.getDate() + 6); return e; }
    default:                return rangeEnd;
  }
}

/**
 * Pace basis from the Business Calendar. `dataThroughKey` is the latest date that
 * actually has loaded data (capped at today), so an in-progress or not-yet-loaded
 * day never inflates the elapsed denominator and drags pace down. For a completed
 * period the natural end is passed as dataThroughKey, yielding
 * bizElapsed === bizTotal (pace == actual).
 */
async function computePaceBasis(fromKey: number, naturalEndKey: number, dataThroughKey: number) {
  const [bizRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(date_key <= ?) AS elapsed
     FROM ie_dim_date
     WHERE is_business_day = 1 AND date_key BETWEEN ? AND ?`,
    [dataThroughKey, fromKey, naturalEndKey],
  );
  const bizTotal = Number(bizRows[0]?.total ?? 0);
  const bizElapsed = Math.max(1, Number(bizRows[0]?.elapsed ?? 0));
  const project = (v: number): number => Math.round(div(v, bizElapsed) * bizTotal);
  return { bizTotal, bizElapsed, project };
}

/**
 * Latest loaded `date_key` for a fact within the report's scope (the same WHERE the
 * data tables use), capped at today. Drives the pace "data-through" date so the
 * elapsed-day denominator only counts days that actually have data — fixing the
 * "Friday data, Monday run" understatement.
 */
async function dataThroughDateKey(
  table: string, joins: string, whereSql: string, params: (string | number)[], todayKey: number,
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(f.date_key) AS maxKey FROM ${table} f ${joins} ${whereSql}`,
    params,
  );
  const maxKey = Number(rows[0]?.maxKey ?? 0);
  return maxKey > 0 ? Math.min(todayKey, maxKey) : todayKey;
}

/** YYYYMMDD int -> 'YYYY-MM-DD' (null for 0/invalid). String math avoids TZ shifts. */
function dateKeyToIso(key: number): string | null {
  if (!key || key <= 0) return null;
  const y = Math.floor(key / 10000);
  const m = Math.floor((key % 10000) / 100);
  const d = key % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Date -> 'MM-DD-YYYY' to match the filter-bar Prior Date Range display. */
function fmtMDY(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
}

/**
 * The FULL natural prior period (entire previous month/quarter/year/week) for the
 * Business Days comparison display — distinct from resolvePeriod().prior, which
 * truncates current_* periods to a month-to-date span for % deltas. Completed
 * periods (prior_* and custom) fall back to resolvePeriod().prior.
 */
function priorNaturalRange(period: string, currentStart: Date, fallbackPrior: DateRange): DateRange {
  const s = currentStart;
  switch (period.toLowerCase().replace(/\s+/g, '_')) {
    case 'current_month':
      return { start: new Date(s.getFullYear(), s.getMonth() - 1, 1), end: new Date(s.getFullYear(), s.getMonth(), 0) };
    case 'current_quarter':
      return { start: new Date(s.getFullYear(), s.getMonth() - 3, 1), end: new Date(s.getFullYear(), s.getMonth(), 0) };
    case 'current_year':
      return { start: new Date(s.getFullYear() - 1, 0, 1), end: new Date(s.getFullYear() - 1, 11, 31) };
    case 'current_week': {
      const start = new Date(s); start.setDate(start.getDate() - 7);
      const end = new Date(s); end.setDate(end.getDate() - 1);
      return { start, end };
    }
    default:
      return fallbackPrior;
  }
}

/**
 * Email Activity report data (Outbound = "sent"), scoped by the standard
 * Agent Activity filters (period/date range, agent, department). Degrades to
 * empty results if the fact table hasn't been created/loaded yet.
 */
export async function getEmailActivity(filters: EmailActivityFilters): Promise<EmailActivityResult> {
  const empty: EmailActivityResult = {
    summary: [], summaryTotal: { agent: 'Total', department: '', totalSent: 0 }, byDay: [],
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_email_activity'))) return empty;

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);

  // Base predicate shared by every query: sent emails, in-period, CSR role,
  // and within the Sales Department - All subtree. The employee + department
  // joins enforce the sales-only rule (and drop unmatched mailboxes). The
  // sales-path test matches the rollup node itself OR any descendant department.
  const EMP_JOIN = `JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key`;
  const DEPT_JOIN = `JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;
  const baseWhere = [
    'f.email_direction = ?',
    'f.date_key BETWEEN ? AND ?',
    'e.role_name = ?',
    "(dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%'))",
  ];
  const baseParams: (string | number)[] = [
    SENT_DIRECTION, toDateKey(current.start), toDateKey(current.end), AGENT_ROLE,
    SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH,
  ];

  // Filters layered on top of the base for the data tables (not the dropdowns,
  // so the option lists stay stable as the user narrows the selection).
  applySelfScope(baseWhere, baseParams, filters.selfEmployeeKey);

  const where = [...baseWhere];
  const params = [...baseParams];
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`f.mailbox_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const baseWhereSql = `WHERE ${baseWhere.join(' AND ')}`;

  const [summaryRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.mailbox_name AS agent, dpt.department_name AS department, SUM(f.email_count) AS totalSent
     FROM ie_fact_email_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereSql}
     GROUP BY f.mailbox_name, dpt.department_name
     ORDER BY dpt.department_name, f.mailbox_name`,
    params,
  );

  const [dayRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.mailbox_name AS agent, dpt.department_name AS department,
            DATE_FORMAT(d.full_date, '%m-%d-%Y') AS date,
            SUM(f.email_count) AS totalSent
     FROM ie_fact_email_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     JOIN ie_dim_date d ON d.date_key = f.date_key
     ${whereSql}
     GROUP BY f.mailbox_name, dpt.department_name, f.date_key, d.full_date
     ORDER BY dpt.department_name, f.mailbox_name, f.date_key`,
    params,
  );

  // Dropdown options: only the sales CSR agents / departments actually present
  // in this report for the selected period — no directory-wide noise.
  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.mailbox_name
     FROM ie_fact_email_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY f.mailbox_name`,
    baseParams,
  );

  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name
     FROM ie_fact_email_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY dpt.department_name`,
    baseParams,
  );

  const schedule = await getReportSchedule('email_activity');

  const summary: EmailSummaryRow[] = summaryRows.map((r) => ({
    agent: r.agent, department: r.department ?? '', totalSent: Number(r.totalSent),
  }));

  const groups = new Map<string, EmailByDayGroup>();
  for (const r of dayRows) {
    const agent = r.agent as string;
    if (!groups.has(agent)) groups.set(agent, { agent, department: r.department ?? '', rows: [], total: { totalSent: 0 } });
    const g = groups.get(agent)!;
    const sent = Number(r.totalSent);
    g.rows.push({ agent, date: r.date, totalSent: sent });
    g.total.totalSent += sent;
  }

  return {
    summary,
    summaryTotal: { agent: 'Total', department: '', totalSent: summary.reduce((s, r) => s + r.totalSent, 0) },
    byDay: [...groups.values()],
    availableUsers: userRows.map((r) => r.mailbox_name as string),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}

// ── Call Activity (Phase 2) ─────────────────────────────────────────────────

export interface CallActivityFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  /** Agent display names (ie_fact_call_activity.agent_name). */
  users?: string[];
  /** Department names (ie_dim_department.department_name). */
  departments?: string[];
  /**
   * When set (SELF data-scope), restrict every query — data AND dropdowns — to
   * this single conformed employee so a salesperson only ever sees their own
   * numbers. Resolved from ie_page_role_access via InsightsPermissionService.
   */
  selfEmployeeKey?: number | null;
  /**
   * Which Agent Activity section is asking. 'sales' keeps the Sales Department -
   * All subtree; 'csr' takes its complement (Customer Service / Tech Support /
   * Billing/CS / etc.) so the CSR section shows the agents it owns and nothing
   * else. The CSR-role guard applies either way. Defaults to 'sales'.
   */
  area?: 'sales' | 'csr';
}

export interface CallSummaryRow {
  agent: string; department: string; businessDays: number; totalCalls: number;
  avgCallsPerDay: number; totalMin: number; avgMinPerDay: number; avgMinPerCall: number;
  callsOver3Min: number;
}
export interface CallByDayRow {
  agent: string; date: string; inbound: number; outbound: number; total: number;
  inboundMin: number; outboundMin: number; totalMin: number; callsOver3Min: number;
}
export interface CallByDayGroup {
  agent: string; department: string; rows: CallByDayRow[];
  total: { inbound: number; outbound: number; total: number; inboundMin: number; outboundMin: number; totalMin: number; callsOver3Min: number };
}
export interface CallDualPoint { label: string; left: number; right: number }

export interface CallActivityResult {
  businessDays: number;
  kpis: Record<string, number>;
  dailyCalls: CallDualPoint[];
  dailyMinutes: CallDualPoint[];
  summary: CallSummaryRow[];
  summaryTotal: CallSummaryRow;
  byDay: CallByDayGroup[];
  availableUsers: string[];
  availableDepartments: string[];
  dataLastUpdated: string | null;
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

/** Round to one decimal place. */
function r1(n: number): number { return Math.round(n * 10) / 10; }
/** Round to two decimal places (money). */
function r2(n: number): number { return Math.round(n * 100) / 100; }
/** Safe divide (0 when denominator is 0). */
function div(a: number, b: number): number { return b ? a / b : 0; }

/**
 * Call Activity report data, scoped by the standard Agent Activity filters and
 * the same sales-only guards as Email (CSR role + Sales Department - All
 * subtree). The page shows Inbound/Outbound only, so Internal calls are
 * excluded from every total. Degrades to empty if the fact table isn't loaded.
 */
export async function getCallActivity(filters: CallActivityFilters): Promise<CallActivityResult> {
  const emptyTotal: CallSummaryRow = {
    agent: 'Total', department: '', businessDays: 0, totalCalls: 0,
    avgCallsPerDay: 0, totalMin: 0, avgMinPerDay: 0, avgMinPerCall: 0, callsOver3Min: 0,
  };
  const empty: CallActivityResult = {
    businessDays: 0, kpis: {}, dailyCalls: [], dailyMinutes: [],
    summary: [], summaryTotal: emptyTotal, byDay: [],
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_call_activity'))) return empty;

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);

  // "Business Days" here = actual days the agent had calls, excluding today's
  // in-progress (partial) day — the per-agent active-day count the live report
  // uses for its per-day averages. The Business Calendar is reserved for pace.
  const todayKey = toDateKey(new Date());

  // Base predicate: Inbound/Outbound only, in-period, CSR role, section subtree.
  // 'sales' keeps the Sales Department - All subtree; 'csr' reads its complement
  // (COALESCE so a not-yet-backfilled hierarchy_path still counts as non-Sales).
  const EMP_JOIN = `JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key`;
  const DEPT_JOIN = `JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;
  const DATE_JOIN = `JOIN ie_dim_date d ON d.date_key = f.date_key`;
  const deptGuard = filters.area === 'csr'
    ? "COALESCE(dpt.hierarchy_path, '') <> ? AND COALESCE(dpt.hierarchy_path, '') NOT LIKE CONCAT(?, '/%')"
    : "(dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%'))";
  const baseWhere = [
    "f.call_direction IN ('Inbound', 'Outbound')",
    'f.date_key BETWEEN ? AND ?',
    'e.role_name = ?',
    deptGuard,
  ];
  const baseParams: (string | number)[] = [fromKey, toKey, AGENT_ROLE, SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH];

  applySelfScope(baseWhere, baseParams, filters.selfEmployeeKey);

  const where = [...baseWhere];
  const params = [...baseParams];
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`f.agent_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const baseWhereSql = `WHERE ${baseWhere.join(' AND ')}`;

  const [summaryRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name AS agent, dpt.department_name AS department,
            SUM(f.call_count) AS totalCalls, SUM(f.call_mins) AS totalMin,
            SUM(f.calls_over_3min) AS callsOver3
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereSql}
     GROUP BY f.agent_name, dpt.department_name
     ORDER BY dpt.department_name, f.agent_name`,
    params,
  );

  // Per-agent "business days" = distinct days the agent had ANY conversation
  // (any direction, incl. Internal), excluding today's partial day. Computed
  // direction-agnostically so an Internal-only day still counts as worked,
  // matching the live report's per-day average divisor.
  const whereNoDirSql = `WHERE ${where.filter((c) => !c.startsWith('f.call_direction')).join(' AND ')}`;
  const [agentDayRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name AS agent,
            COUNT(DISTINCT CASE WHEN f.date_key <> ? THEN f.date_key END) AS businessDays
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereNoDirSql}
     GROUP BY f.agent_name`,
    [todayKey, ...params],
  );
  const agentDaysMap = new Map<string, number>(
    agentDayRows.map((r) => [r.agent as string, Number(r.businessDays)]),
  );

  const [dayRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name AS agent, dpt.department_name AS department,
            DATE_FORMAT(d.full_date, '%m-%d-%Y') AS date,
            SUM(CASE WHEN f.call_direction = 'Inbound'  THEN f.call_count ELSE 0 END) AS inbound,
            SUM(CASE WHEN f.call_direction = 'Outbound' THEN f.call_count ELSE 0 END) AS outbound,
            SUM(CASE WHEN f.call_direction = 'Inbound'  THEN f.call_mins  ELSE 0 END) AS inboundMin,
            SUM(CASE WHEN f.call_direction = 'Outbound' THEN f.call_mins  ELSE 0 END) AS outboundMin,
            SUM(f.calls_over_3min) AS callsOver3
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${DATE_JOIN}
     ${whereSql}
     GROUP BY f.agent_name, dpt.department_name, f.date_key, d.full_date
     ORDER BY dpt.department_name, f.agent_name, f.date_key`,
    params,
  );

  const [seriesRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(d.full_date, '%b %e') AS label, f.date_key AS dk,
            SUM(f.call_count) AS totalCalls, SUM(f.call_mins) AS totalMin,
            COUNT(DISTINCT f.agent_name) AS agents
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${DATE_JOIN}
     ${whereSql}
     GROUP BY f.date_key, d.full_date
     ORDER BY f.date_key`,
    params,
  );

  // Team-level active days (distinct days anyone in scope had any conversation,
  // excluding today) — divisor for the Total row and the KPI per-day averages.
  const [teamDayRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT CASE WHEN f.date_key <> ? THEN f.date_key END) AS n
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereNoDirSql}`,
    [todayKey, ...params],
  );
  const teamBusinessDays = Number(teamDayRows[0]?.n ?? 0);

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.agent_name
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY f.agent_name`,
    baseParams,
  );

  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name
     FROM ie_fact_call_activity f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY dpt.department_name`,
    baseParams,
  );

  const schedule = await getReportSchedule('call_activity');

  // Minutes are displayed as whole numbers; keep the raw (decimal) sums for the
  // avg-min-per-call ratio (the only figure shown with a decimal) and round
  // everything else for display.
  const summary: CallSummaryRow[] = summaryRows.map((r) => {
    const totalCalls = Number(r.totalCalls);
    const rawMin = Number(r.totalMin);
    const days = agentDaysMap.get(r.agent as string) ?? 0;
    return {
      agent: r.agent, department: r.department ?? '', businessDays: days, totalCalls,
      avgCallsPerDay: Math.round(div(totalCalls, days)),
      totalMin: Math.round(rawMin),
      avgMinPerDay: Math.round(div(rawMin, days)),
      avgMinPerCall: r1(div(rawMin, totalCalls)),
      callsOver3Min: Number(r.callsOver3) || 0,
    };
  });

  const grandCalls = summaryRows.reduce((s, r) => s + Number(r.totalCalls), 0);
  const grandMinRaw = summaryRows.reduce((s, r) => s + Number(r.totalMin), 0);
  const grandOver3 = summaryRows.reduce((s, r) => s + (Number(r.callsOver3) || 0), 0);
  const summaryTotal: CallSummaryRow = {
    agent: 'Total', department: '', businessDays: teamBusinessDays, totalCalls: grandCalls,
    avgCallsPerDay: Math.round(div(grandCalls, teamBusinessDays)),
    totalMin: Math.round(grandMinRaw),
    avgMinPerDay: Math.round(div(grandMinRaw, teamBusinessDays)),
    avgMinPerCall: r1(div(grandMinRaw, grandCalls)),
    callsOver3Min: grandOver3,
  };

  // Right-hand chart series = average per agent ACTIVE that day (not a fixed
  // period-wide divisor), so light-staffing days aren't understated.
  const dailyCalls: CallDualPoint[] = seriesRows.map((r) => {
    const total = Number(r.totalCalls);
    const agents = Number(r.agents) || 0;
    return { label: r.label, left: total, right: Math.round(div(total, agents)) };
  });
  const dailyMinutes: CallDualPoint[] = seriesRows.map((r) => {
    const total = Number(r.totalMin);
    const agents = Number(r.agents) || 0;
    return { label: r.label, left: Math.round(total), right: Math.round(div(total, agents)) };
  });

  const groups = new Map<string, CallByDayGroup>();
  for (const r of dayRows) {
    const agent = r.agent as string;
    if (!groups.has(agent)) {
      groups.set(agent, {
        agent, department: r.department ?? '', rows: [],
        total: { inbound: 0, outbound: 0, total: 0, inboundMin: 0, outboundMin: 0, totalMin: 0, callsOver3Min: 0 },
      });
    }
    const g = groups.get(agent)!;
    const inbound = Number(r.inbound), outbound = Number(r.outbound);
    const inboundMinRaw = Number(r.inboundMin), outboundMinRaw = Number(r.outboundMin);
    const over3 = Number(r.callsOver3) || 0;
    g.rows.push({
      agent, date: r.date, inbound, outbound, total: inbound + outbound,
      inboundMin: Math.round(inboundMinRaw),
      outboundMin: Math.round(outboundMinRaw),
      totalMin: Math.round(inboundMinRaw + outboundMinRaw),
      callsOver3Min: over3,
    });
    g.total.inbound += inbound;
    g.total.outbound += outbound;
    g.total.total += inbound + outbound;
    g.total.inboundMin += inboundMinRaw;
    g.total.outboundMin += outboundMinRaw;
    g.total.totalMin += inboundMinRaw + outboundMinRaw;
    g.total.callsOver3Min += over3;
  }
  // Round each group's aggregated minutes once (from the raw running sums).
  for (const g of groups.values()) {
    g.total.inboundMin = Math.round(g.total.inboundMin);
    g.total.outboundMin = Math.round(g.total.outboundMin);
    g.total.totalMin = Math.round(g.total.totalMin);
  }

  return {
    businessDays: teamBusinessDays,
    kpis: {
      aa_business_days: teamBusinessDays,
      aa_total_calls: grandCalls,
      aa_total_talk_minutes: Math.round(grandMinRaw),
      aa_avg_calls_per_day: Math.round(div(grandCalls, teamBusinessDays)),
      aa_avg_min_per_day: Math.round(div(grandMinRaw, teamBusinessDays)),
      aa_avg_handle_time: r1(div(grandMinRaw, grandCalls)),
    },
    dailyCalls,
    dailyMinutes,
    summary,
    summaryTotal,
    byDay: [...groups.values()],
    availableUsers: userRows.map((r) => r.agent_name as string),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}

// ── Tickets & Tasks (Phase 3) ───────────────────────────────────────────────

export interface TicketTaskFilters {
  /** Agent display names (ie_fact_ticket_task.agent_name). */
  users?: string[];
  /** Department names (ie_dim_department.department_name). */
  departments?: string[];
  /**
   * When set (SELF data-scope), restrict every query — data AND dropdowns — to
   * this single conformed employee so a salesperson only ever sees their own
   * numbers. Resolved from ie_page_role_access via InsightsPermissionService.
   */
  selfEmployeeKey?: number | null;
  /**
   * Which Agent Activity section is asking. 'sales' keeps the Sales Department -
   * All subtree; 'csr' takes its complement (Customer Service / Tech Support /
   * VIP Support / etc.) so the CSR section shows the agents it owns and nothing
   * else. The CSR-role guard applies either way. Defaults to 'sales'.
   */
  area?: 'sales' | 'csr';
}

/** Overdue = a real due date that has already passed. Shared by the count and the detail list. */
const PAST_DUE_PREDICATE = 'f.next_contact IS NOT NULL AND DATE(f.next_contact) < CURDATE()';

/**
 * Bucket expressions shared by the live report and the daily snapshot capture.
 * Bucket = next_contact (the task/ticket DueOn) vs today. NULL due date -> no
 * bucket (matches the legacy proc's PastDueCurrent CASE with no ELSE).
 */
const TICKET_CUR_EXPR = `SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) > CURDATE())`;
const TICKET_DUE_EXPR = `SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) = CURDATE())`;
const TICKET_PAST_EXPR = `SUM(${PAST_DUE_PREDICATE})`;

/**
 * Joins + base predicate every Tickets & Tasks query shares: conform to the
 * current employee/department dimension rows, keep CSRs only, and keep the
 * section's own department subtree. The CSR section reads the complement of the
 * Sales subtree; COALESCE so a department whose hierarchy_path hasn't been
 * backfilled yet still counts as non-Sales instead of dropping out on a NULL
 * comparison. `selfEmployeeKey` is folded into the BASE predicate so a
 * SELF-scoped viewer can never widen past themselves.
 */
function ticketTaskBase(area: 'sales' | 'csr' | undefined, selfEmployeeKey?: number | null) {
  const deptGuard = area === 'csr'
    ? "COALESCE(dpt.hierarchy_path, '') <> ? AND COALESCE(dpt.hierarchy_path, '') NOT LIKE CONCAT(?, '/%')"
    : "(dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%'))";

  const baseWhere = ['e.role_name = ?', deptGuard];
  const baseParams: (string | number)[] = [AGENT_ROLE, SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH];
  applySelfScope(baseWhere, baseParams, selfEmployeeKey);

  return {
    EMP_JOIN: 'JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key',
    DEPT_JOIN: 'JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key',
    baseWhere,
    baseParams,
  };
}

export interface TicketRow {
  agent: string; department: string; classification: string;
  current: number; dueToday: number; pastDue: number;
}
export interface TicketGroup {
  agent: string; department: string; rows: TicketRow[];
  total: { current: number; dueToday: number; pastDue: number };
}

export interface TicketsTasksResult {
  groups: TicketGroup[];
  grandTotal: { current: number; dueToday: number; pastDue: number };
  availableUsers: string[];
  availableDepartments: string[];
  dataLastUpdated: string | null;
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

/**
 * Tickets & Tasks report data: the current open-work-item snapshot, counted by
 * (agent, classification) into Current / Due Today / Past Due buckets. This is a
 * SNAPSHOT report, so there is NO period filter — it always reflects the latest
 * ingested snapshot. Buckets are derived here from next_contact vs CURDATE() so
 * they stay accurate between snapshot runs. CSR-role guard as on every AA report;
 * the department guard follows `filters.area` — the Sales Department - All subtree
 * for the Sales section, its complement for the CSR section — matched by the
 * conformed assignee. Degrades to empty if the fact table isn't loaded yet.
 */
export async function getTicketsTasks(filters: TicketTaskFilters): Promise<TicketsTasksResult> {
  const empty: TicketsTasksResult = {
    groups: [], grandTotal: { current: 0, dueToday: 0, pastDue: 0 },
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_ticket_task'))) return empty;

  const { EMP_JOIN, DEPT_JOIN, baseWhere, baseParams } = ticketTaskBase(filters.area, filters.selfEmployeeKey);

  const where = [...baseWhere];
  const params = [...baseParams];
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`f.agent_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const baseWhereSql = `WHERE ${baseWhere.join(' AND ')}`;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name AS agent, dpt.department_name AS department, f.classification AS classification,
            ${TICKET_CUR_EXPR} AS cur, ${TICKET_DUE_EXPR} AS dueToday, ${TICKET_PAST_EXPR} AS pastDue
     FROM ie_fact_ticket_task f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereSql}
     GROUP BY f.agent_name, dpt.department_name, f.classification
     HAVING cur > 0 OR dueToday > 0 OR pastDue > 0
     ORDER BY dpt.department_name, f.agent_name, f.classification`,
    params,
  );

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.agent_name
     FROM ie_fact_ticket_task f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY f.agent_name`,
    baseParams,
  );

  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name
     FROM ie_fact_ticket_task f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY dpt.department_name`,
    baseParams,
  );

  const schedule = await getReportSchedule('ticket_open');

  const grandTotal = { current: 0, dueToday: 0, pastDue: 0 };
  const groups = new Map<string, TicketGroup>();
  for (const r of rows) {
    const agent = r.agent as string;
    if (!groups.has(agent)) {
      groups.set(agent, {
        agent, department: r.department ?? '', rows: [],
        total: { current: 0, dueToday: 0, pastDue: 0 },
      });
    }
    const g = groups.get(agent)!;
    const current = Number(r.cur), dueToday = Number(r.dueToday), pastDue = Number(r.pastDue);
    g.rows.push({ agent, department: r.department ?? '', classification: r.classification, current, dueToday, pastDue });
    g.total.current += current;
    g.total.dueToday += dueToday;
    g.total.pastDue += pastDue;
    grandTotal.current += current;
    grandTotal.dueToday += dueToday;
    grandTotal.pastDue += pastDue;
  }

  return {
    groups: [...groups.values()],
    grandTotal,
    availableUsers: userRows.map((r) => r.agent_name as string),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}

export interface TicketPastDueFilters {
  /** The agent whose Past Due cell was opened (ie_fact_ticket_task.agent_name). */
  agent: string;
  /** The classification row that was opened. */
  classification: string;
  selfEmployeeKey?: number | null;
  area?: 'sales' | 'csr';
}

export interface PastDueItem {
  /** 'Ticket' or 'Task'. */
  processType: string;
  /** Ticket number for tickets, task id for tasks — what the CRM screen is keyed on. */
  referenceId: number;
  customerName: string | null;
  /** Tasks only: the task type. */
  taskType: string | null;
  /** Tickets only: parent classification. */
  classification: string | null;
  /** Tickets only: sub-classification. */
  subClassification: string | null;
  /** Where the item stands — a task status ('Promised To Pay') or a ticket status ('Assigned'). */
  status: string | null;
  /** Due date (YYYY-MM-DD, formatted in SQL so no timezone shifting can occur). */
  nextContact: string | null;
  crmUrl: string | null;
}

/**
 * The individual past-due work items behind one Past Due cell, oldest due date
 * first so the most overdue work is at the top. Same guards as the aggregate —
 * including SELF scope — so opening a cell can never reveal a row the report
 * itself would have excluded.
 *
 * The two process types carry different meaning in the same columns, so they are
 * split out here rather than in the UI: a Task's `classification` is really its
 * task type and its `sub_classification` is just the literal 'Task', while a
 * Ticket's pair is the real parent/child classification. `status` is meaningful
 * for both (a task status or a ticket status) and is passed through as-is.
 */
export async function getTicketsPastDue(filters: TicketPastDueFilters): Promise<PastDueItem[]> {
  if (!(await factTableExists('ie_fact_ticket_task'))) return [];

  const { EMP_JOIN, DEPT_JOIN, baseWhere, baseParams } = ticketTaskBase(filters.area, filters.selfEmployeeKey);
  const where = [...baseWhere, 'f.agent_name = ?', 'f.classification = ?', PAST_DUE_PREDICATE];
  const params = [...baseParams, filters.agent, filters.classification];

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT f.process_type, f.ticket_id, f.task_id, f.customer_name,
            f.classification, f.sub_classification, f.status, f.crm_url,
            DATE_FORMAT(f.next_contact, '%Y-%m-%d') AS next_contact
     FROM ie_fact_ticket_task f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     WHERE ${where.join(' AND ')}
     ORDER BY f.next_contact ASC`,
    params,
  );

  return rows.map((r) => {
    const isTask = r.process_type === 'Task';
    return {
      processType: r.process_type as string,
      referenceId: Number(isTask ? r.task_id : r.ticket_id),
      customerName: (r.customer_name as string | null) ?? null,
      taskType: isTask ? ((r.classification as string | null) ?? null) : null,
      classification: isTask ? null : ((r.classification as string | null) ?? null),
      subClassification: isTask ? null : ((r.sub_classification as string | null) ?? null),
      status: (r.status as string | null) ?? null,
      nextContact: (r.next_contact as string | null) ?? null,
      crmUrl: (r.crm_url as string | null) ?? null,
    };
  });
}

// ── Tickets & Tasks daily snapshot ──────────────────────────────────────────

/**
 * Calendar-date logic for the snapshot runs in the business timezone. The
 * ie-rollup PM2 cron is UTC and the primary DB session is pinned to UTC, so
 * the capture gate derives the wall-clock hour/date explicitly (same
 * toLocaleString-with-timeZone pattern as notifications/quietHours.ts) instead
 * of trusting the host timezone.
 */
const BUSINESS_TZ = 'America/New_York';

/** Calendar date (YYYY-MM-DD) and hour-of-day of `now` in the business timezone. */
function businessNow(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  // hourCycle quirk: some ICU builds render midnight as '24'.
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: parseInt(get('hour'), 10) % 24 };
}

export interface DailyCaptureResult {
  captured: boolean;
  rows: number;
  /** Why the run was a no-op ('ok' when it captured). Surfaced in the rollup batch id. */
  reason: string;
}

/**
 * Persist today's per-agent Current / Due Today / Past Due counts into
 * ie_ticket_task_daily — the ONLY durable history of these buckets, since
 * ie_fact_ticket_task is a rolling DELETE+INSERT snapshot. Called by
 * RollupWorker every half hour; the first run at/after the configured hour
 * (ie_config.ticket_daily_capture_hour, ET) wins and later runs no-op, so each
 * day gets exactly one morning snapshot per area per agent.
 *
 * Guards, in order:
 *  - both tables must exist (degrade to no-op before migrations/first load);
 *  - before the capture hour (ET) -> wait;
 *  - the bucket expressions compare against CURDATE() on the UTC-pinned
 *    primary session, so skip if the UTC date has rolled past the ET date
 *    (>= ~8pm ET) — a late catch-up run must never bucket against tomorrow;
 *  - already captured today -> no-op.
 */
export async function captureDailyTicketTotals(now: Date = new Date()): Promise<DailyCaptureResult> {
  if (!(await factTableExists('ie_fact_ticket_task'))) return { captured: false, rows: 0, reason: 'no-fact-table' };
  if (!(await factTableExists('ie_ticket_task_daily'))) return { captured: false, rows: 0, reason: 'no-daily-table' };

  const [cfgRows] = await pool.execute<RowDataPacket[]>(
    `SELECT config_value FROM ie_config WHERE config_key = 'ticket_daily_capture_hour'`,
  );
  const captureHour = parseInt((cfgRows[0]?.config_value as string) ?? '8', 10) || 8;

  const { date: etDate, hour: etHour } = businessNow(now);
  if (etHour < captureHour) return { captured: false, rows: 0, reason: 'before-capture-hour' };
  if (now.toISOString().slice(0, 10) !== etDate) return { captured: false, rows: 0, reason: 'utc-date-rollover' };

  const [existing] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM ie_ticket_task_daily WHERE snapshot_date = ? LIMIT 1`,
    [etDate],
  );
  if (existing.length > 0) return { captured: false, rows: 0, reason: 'already-captured' };

  let rows = 0;
  for (const area of ['sales', 'csr'] as const) {
    const { EMP_JOIN, DEPT_JOIN, baseWhere, baseParams } = ticketTaskBase(area);
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO ie_ticket_task_daily
         (snapshot_date, area, employee_key, agent_name, department_name, cur, due_today, past_due)
       SELECT ?, ?, f.employee_key, f.agent_name, dpt.department_name,
              ${TICKET_CUR_EXPR} AS cur, ${TICKET_DUE_EXPR} AS due_today, ${TICKET_PAST_EXPR} AS past_due
       FROM ie_fact_ticket_task f
       ${EMP_JOIN}
       ${DEPT_JOIN}
       WHERE ${baseWhere.join(' AND ')}
       GROUP BY f.employee_key, f.agent_name, dpt.department_name
       HAVING cur > 0 OR due_today > 0 OR past_due > 0`,
      [etDate, area, ...baseParams],
    );
    rows += result.affectedRows ?? 0;
  }
  return { captured: true, rows, reason: 'ok' };
}

export interface TicketDailyHistoryFilters {
  area: 'sales' | 'csr';
  /** SELF data-scope: restrict the trend to the viewer's own rows. */
  selfEmployeeKey?: number | null;
  /** Agent display names (same values as the tickets report's users filter). */
  users?: string[];
  /** Department names as captured at snapshot time. */
  departments?: string[];
}

export interface TicketDailyPoint {
  /** Snapshot day, YYYY-MM-DD (formatted in SQL so no timezone shifting can occur). */
  date: string;
  current: number;
  dueToday: number;
  pastDue: number;
}

/**
 * The daily Current / Due Today / Past Due history for one section, summed
 * server-side per day over whoever is in scope: SELF viewers get only their own
 * rows; everyone else gets the whole section, narrowed by the same
 * users/departments filters that drive the tickets table. The response is
 * always one point per day regardless of how many agents are behind it.
 */
export async function getTicketsDailyHistory(filters: TicketDailyHistoryFilters): Promise<TicketDailyPoint[]> {
  if (!(await factTableExists('ie_ticket_task_daily'))) return [];

  const where = ['d.area = ?'];
  const params: (string | number)[] = [filters.area];
  if (filters.selfEmployeeKey != null) {
    where.push('d.employee_key = ?');
    params.push(filters.selfEmployeeKey);
  }
  if (filters.departments?.length) {
    where.push(`d.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`d.agent_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(d.snapshot_date, '%Y-%m-%d') AS date,
            SUM(d.cur) AS cur, SUM(d.due_today) AS dueToday, SUM(d.past_due) AS pastDue
     FROM ie_ticket_task_daily d
     WHERE ${where.join(' AND ')}
     GROUP BY d.snapshot_date
     ORDER BY d.snapshot_date`,
    params,
  );

  return rows.map((r) => ({
    date: r.date as string,
    current: Number(r.cur),
    dueToday: Number(r.dueToday),
    pastDue: Number(r.pastDue),
  }));
}

// ── Tickets & Tasks productivity roll-up ────────────────────────────────────

export interface TicketProductivityFilters {
  area: 'sales' | 'csr';
  /** Date-range selector (same values the other AA reports accept). */
  period: string;
  customStart?: string;
  customEnd?: string;
  /** SELF data-scope: restrict to the viewer's own rows. */
  selfEmployeeKey?: number | null;
  /** Agent display names (same values as the tickets report's users filter). */
  users?: string[];
  /** Department names as captured at snapshot time. */
  departments?: string[];
}

export interface TicketProductivityDayRow {
  /** Snapshot day, YYYY-MM-DD (formatted in SQL so no timezone shifting can occur). */
  date: string;
  agent: string;
  department: string;
  employeeKey: number;
  /** Sales only: which slice this row is — the Sales page renders two sections
   *  (Contact Manager vs all other tickets/tasks). Omitted for CSR (segments are
   *  summed server-side, so CSR output is unchanged). */
  segment?: 'contact_manager' | 'other';
  /** Open work items assigned at the start of the day (ie_ticket_task_daily inventory). */
  beginning: number;
  /** Items created/assigned to the agent on the day. */
  newAssigned: number;
  /** Distinct items the agent had activity on during the day. */
  touched: number;
  /** Items the agent closed on the day. */
  closed: number;
}

/** YYYY-MM-DD from a Date's LOCAL components (per the date-handling convention). */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Per-agent-per-day productivity rows for one section over the selected range.
 * One row per (snapshot_date, agent); the frontend rolls these up into the
 * per-agent summary and the expandable per-day breakdown. Same SELF-scope and
 * users/departments narrowing as the daily-history trend. Degrades to empty if
 * the roll-up table isn't built yet.
 */
export async function getTicketProductivity(filters: TicketProductivityFilters): Promise<TicketProductivityDayRow[]> {
  if (!(await factTableExists('ie_ticket_task_productivity_daily'))) return [];

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const startDate = toLocalDateStr(current.start);
  const endDate = toLocalDateStr(current.end);

  const where = ['d.area = ?', 'd.snapshot_date BETWEEN ? AND ?'];
  const params: (string | number)[] = [filters.area, startDate, endDate];
  if (filters.selfEmployeeKey != null) {
    where.push('d.employee_key = ?');
    params.push(filters.selfEmployeeKey);
  }
  if (filters.departments?.length) {
    where.push(`d.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`d.agent_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }

  // Sales keeps the segment so the page can render the Contact Manager split;
  // every other area sums the segments (collapsing to one row per day/agent) so
  // its output is byte-for-byte what it was before segmentation. SUM over the
  // single sales row is a no-op, so one grouped query serves both.
  const isSales = filters.area === 'sales';
  const segSelect = isSales ? 'd.segment AS segment,' : '';
  const segGroup = isSales ? ', d.segment' : '';

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(d.snapshot_date, '%Y-%m-%d') AS date,
            MAX(d.agent_name) AS agent, MAX(d.department_name) AS department, d.employee_key AS employeeKey,
            ${segSelect}
            SUM(d.beginning) AS beginning, SUM(d.new_assigned) AS newAssigned,
            SUM(d.touched) AS touched, SUM(d.closed) AS closed
     FROM ie_ticket_task_productivity_daily d
     JOIN ie_dim_employee e ON e.is_current = 1 AND e.is_active = 1 AND e.employee_key = d.employee_key
     WHERE ${where.join(' AND ')}
     GROUP BY d.snapshot_date, d.employee_key${segGroup}
     ORDER BY agent, date`,
    params,
  );

  return rows.map((r) => ({
    date: r.date as string,
    agent: (r.agent as string) ?? '',
    department: (r.department as string) ?? '',
    employeeKey: Number(r.employeeKey),
    ...(isSales ? { segment: r.segment === 'contact_manager' ? 'contact_manager' as const : 'other' as const } : {}),
    beginning: Number(r.beginning),
    newAssigned: Number(r.newAssigned),
    touched: Number(r.touched),
    closed: Number(r.closed),
  }));
}

/** One agent's flow count for a single day and segment, keyed by conformed email. */
type Segment = 'contact_manager' | 'other';
interface CrmFlowRow { email: string; agentName: string | null; segment: Segment; count: number }

/**
 * Run one grouped, single-day CRM read (READ-ONLY) and return per-(assignee-email,
 * segment) counts. The unionSql must yield (user_id, segment) — plus an `item`
 * column for DISTINCT-item metrics like touched. Assignee identity mirrors the
 * live extracts: tblSalesPeople.UserID = the my_aspnet_users id stored on the
 * task/ticket, UserID 12 (system) excluded, deduped to one email per UserID.
 */
async function crmFlowCounts(crm: mysql.Connection, unionSql: string, params: unknown[]): Promise<CrmFlowRow[]> {
  const [rows] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT sp.email AS email, MAX(sp.SalesPersonName) AS agentName, x.segment AS segment, SUM(x.n) AS n
     FROM (SELECT user_id, segment, COUNT(*) AS n FROM (${unionSql}) e GROUP BY user_id, segment) x
     JOIN (SELECT UserID, MIN(email) AS email, MAX(SalesPersonName) AS SalesPersonName
           FROM tblSalesPeople WHERE UserID NOT IN (12) AND email IS NOT NULL AND email <> '' GROUP BY UserID) sp
       ON sp.UserID = x.user_id
     GROUP BY sp.email, x.segment`,
    params,
  );
  return rows.map((r) => ({
    email: String(r.email).toLowerCase().trim(),
    agentName: (r.agentName as string | null) ?? null,
    segment: r.segment === 'contact_manager' ? 'contact_manager' : 'other',
    count: Number(r.n),
  }));
}

/**
 * Finalize the PRIOR completed ET day's per-agent productivity into
 * ie_ticket_task_productivity_daily (is_backfilled = 0). Called by RollupWorker;
 * the first run at/after the capture hour that hasn't yet captured the prior day
 * wins, later runs no-op. Beginning inventory is read from ie_ticket_task_daily
 * (the 8am snapshot already captured that morning); new/touched/closed come from
 * a single-day read of the CRM audit trail. Wrapped defensively — any CRM/DB
 * hiccup returns a no-op reason and never breaks the rollup cycle.
 */
export async function captureDailyTicketProductivity(now: Date = new Date()): Promise<DailyCaptureResult> {
  if (!(await factTableExists('ie_ticket_task_productivity_daily'))) return { captured: false, rows: 0, reason: 'no-productivity-table' };
  if (!(await factTableExists('ie_ticket_task_daily'))) return { captured: false, rows: 0, reason: 'no-daily-table' };
  if (!crmDatabaseConfig) return { captured: false, rows: 0, reason: 'no-crm-config' };

  const [cfgRows] = await pool.execute<RowDataPacket[]>(
    `SELECT config_value FROM ie_config WHERE config_key = 'ticket_daily_capture_hour'`,
  );
  const captureHour = parseInt((cfgRows[0]?.config_value as string) ?? '8', 10) || 8;

  // Touched cleanup toggle (default ON). When on, machine-written notes are
  // excluded from the effort metric via the shared classifier so a status stamp
  // or auto-close never counts as human work.
  const [exclCfg] = await pool.execute<RowDataPacket[]>(
    `SELECT config_value FROM ie_config WHERE config_key = ?`, [TOUCHED_EXCLUDE_SYSTEM_FLAG],
  );
  const excludeSystem = systemExclusionEnabled(exclCfg[0]?.config_value as string | undefined);

  const { date: etDate, hour: etHour } = businessNow(now);
  if (etHour < captureHour) return { captured: false, rows: 0, reason: 'before-capture-hour' };

  // The day we finalize is yesterday (ET) — the most recent fully-closed day.
  const [y, m, d] = etDate.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);

  const [existing] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM ie_ticket_task_productivity_daily WHERE snapshot_date = ? LIMIT 1`,
    [day],
  );
  if (existing.length > 0) return { captured: false, rows: 0, reason: 'already-captured' };

  // Conform map: email -> {employee_key, area, department_name} for current CSR
  // agents, area decided by the Sales Department - All subtree (same rule as the
  // backfill and the live report).
  const [empRows] = await pool.query<RowDataPacket[]>(
    `SELECT LOWER(TRIM(e.email)) AS email, e.employee_key AS employeeKey, dpt.department_name AS departmentName,
            CASE WHEN dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%') THEN 'sales' ELSE 'csr' END AS area
     FROM ie_dim_employee e
     JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key
     WHERE e.is_current = 1 AND e.role_name = ? AND e.email IS NOT NULL AND e.email <> ''`,
    [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH, AGENT_ROLE],
  );
  const conform = new Map<string, { employeeKey: number; area: 'sales' | 'csr'; departmentName: string | null }>();
  for (const r of empRows) {
    conform.set(String(r.email), {
      employeeKey: Number(r.employeeKey),
      area: r.area === 'sales' ? 'sales' : 'csr',
      departmentName: (r.departmentName as string | null) ?? null,
    });
  }

  // Beginning inventory (D) straight from the morning bucket snapshot.
  const [beginRows] = await pool.query<RowDataPacket[]>(
    `SELECT area, employee_key AS employeeKey, MAX(agent_name) AS agentName, MAX(department_name) AS departmentName,
            SUM(cur + due_today + past_due) AS beginning
     FROM ie_ticket_task_daily WHERE snapshot_date = ?
     GROUP BY area, employee_key`,
    [day],
  );
  // The bucket snapshot for D isn't in place yet (first run after deploy, or the
  // bucket capture above no-opped). Bail WITHOUT finalizing so a later run can
  // capture once ie_ticket_task_daily is populated — otherwise we'd lock in a
  // zero-beginning day under the already-captured guard. There is always a
  // standing Contact Manager pool, so an empty result reliably means "no bucket".
  if (beginRows.length === 0) return { captured: false, rows: 0, reason: 'no-bucket-day' };

  // Single-day CRM reads (READ-ONLY). Population rules mirror the live extracts:
  // task depts 1/2, task type <> 19, tickets by their status timeline. Every row
  // carries a segment so the Sales Productivity page can split the Contact
  // Manager task type out: tasks -> Contact Manager vs other by tblTaskType.Title;
  // tickets are always 'other'.
  const SEG = `CASE WHEN tt.Title = 'Contact Manager' THEN 'contact_manager' ELSE 'other' END`;
  const newSql = `
    SELECT t.AssignedTo AS user_id, ${SEG} AS segment FROM tblTask t
      JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (1,2)
      WHERE t.TaskTypeID <> 19 AND DATE(t.CreatedOn) = ?
    UNION ALL
    SELECT tk.AssignedToUserID AS user_id, 'other' AS segment FROM tblTicket tk WHERE DATE(tk.CreatedOn) = ?`;
  const closedSql = `
    SELECT t.AssignedTo AS user_id, ${SEG} AS segment FROM tblTask t
      JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (1,2)
      WHERE t.TaskTypeID <> 19 AND DATE(t.CompletedOn) = ?
    UNION ALL
    SELECT tk.AssignedToUserID AS user_id, 'other' AS segment FROM tblTicket tk
      WHERE tk.TicketID IN (SELECT TicketID FROM tblTicketStatusHistory WHERE StatusID = 5 AND DATE(CreatedOn) = ?)`;
  // Touched = distinct items the agent had a NOTED ACTION on that day, keyed by
  // the ACTOR (who did the work) — a noted tblAction for tasks, a tblTicketNote
  // for tickets (the same human-activity the live report uses for "last touched
  // by"). Because only real notes/actions count, system state changes and
  // manager reassignments are excluded, and the email conform below drops any
  // actor who isn't a reporting CSR agent. DISTINCT (item, actor) so a single
  // item worked multiple times in a day counts once for that agent.
  // System-generated notes (auto-closes, status stamps, ticket transitions) are
  // excluded from the actor-keyed effort metric via the shared classifier, gated
  // by the ie_config toggle so it can be turned off without a redeploy. The
  // predicate carries no bind params, so the [day, day] binding is unchanged.
  const keepHumanTask = excludeSystem ? ` AND ${buildSystemNoteExclusionSql('a.Note')}` : '';
  const keepHumanTicket = excludeSystem ? ` AND ${buildSystemNoteExclusionSql('tn.Note')}` : '';
  const touchedSql = `
    SELECT DISTINCT CONCAT('T', a.TaskID) AS item, a.CompletedBy AS user_id, ${SEG} AS segment
    FROM tblAction a
      JOIN tblTask t      ON t.TaskID = a.TaskID
      JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (1,2)
    WHERE t.TaskTypeID <> 19 AND a.Note <> '' AND a.CompletedBy IS NOT NULL AND DATE(a.CompletedOn) = ?${keepHumanTask}
    UNION ALL
    SELECT DISTINCT CONCAT('K', tn.TicketID) AS item, tn.CreatedBy AS user_id, 'other' AS segment
    FROM tblTicketNote tn
    WHERE tn.CreatedBy IS NOT NULL AND DATE(tn.CreatedOn) = ?${keepHumanTicket}`;
  // Contact Manager beginning inventory (CURRENT open CM tasks with a due date,
  // per assignee) — the segment slice of the bucket total. The bucket carries no
  // task-type detail, so we read CM live from the CRM and derive
  // other = total - CM. Mirrors task_open.extract.sql's open-task rule.
  const cmBeginningSql = `
    SELECT sp.email AS email, MAX(sp.SalesPersonName) AS agentName, SUM(x.n) AS n
    FROM (
      SELECT t.AssignedTo AS user_id, COUNT(*) AS n
      FROM tblTask t
        JOIN tblTaskType tt   ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (1,2)
        JOIN tblTaskStatus ts ON ts.TaskTypeID = t.TaskTypeID AND ts.TaskStatusID = t.TaskStatusID
      WHERE tt.Title = 'Contact Manager' AND t.TaskTypeID <> 19
        AND (t.CompletedOn = '1-1-1' OR t.CompletedOn >= DATE_SUB(NOW(), INTERVAL 2 MONTH))
        AND (ts.Closed = 0 OR ts.Title = 'Contact Past Due')
        AND t.DueOn > '1900-01-01'
      GROUP BY t.AssignedTo
    ) x
    JOIN (SELECT UserID, MIN(email) AS email, MAX(SalesPersonName) AS SalesPersonName
          FROM tblSalesPeople WHERE UserID NOT IN (12) AND email IS NOT NULL AND email <> '' GROUP BY UserID) sp
      ON sp.UserID = x.user_id
    GROUP BY sp.email`;

  const crm = await mysql.createConnection({
    host: crmDatabaseConfig.host,
    user: crmDatabaseConfig.user,
    password: crmDatabaseConfig.password,
    database: crmDatabaseConfig.database,
    connectTimeout: 60_000,
    dateStrings: true,
    charset: 'utf8mb4',
  });
  let newRows: CrmFlowRow[] = [];
  let closedRows: CrmFlowRow[] = [];
  let touchedRows: CrmFlowRow[] = [];
  let cmBeginRows: Array<{ email: string; count: number }> = [];
  try {
    newRows = await crmFlowCounts(crm, newSql, [day, day]);
    closedRows = await crmFlowCounts(crm, closedSql, [day, day]);
    touchedRows = await crmFlowCounts(crm, touchedSql, [day, day]);
    const [cmRows] = await crm.query<mysql.RowDataPacket[]>(cmBeginningSql);
    cmBeginRows = cmRows.map((r) => ({ email: String(r.email).toLowerCase().trim(), count: Number(r.n) }));
  } catch (err) {
    await crm.end().catch(() => { /* socket already gone */ });
    return { captured: false, rows: 0, reason: `crm-error:${(err as Error).message?.slice(0, 60) ?? 'unknown'}` };
  }
  await crm.end().catch(() => { /* socket already gone */ });

  // Merge everything onto (area, employee_key, segment). Beginning seeds the rows
  // (bucket total split into CM vs other); flow metrics are folded in via the
  // email conform map, each carrying its own segment.
  interface Acc { area: 'sales' | 'csr'; employeeKey: number; segment: Segment; agentName: string | null; departmentName: string | null; beginning: number; newAssigned: number; touched: number; closed: number }
  const acc = new Map<string, Acc>();
  const keyOf = (area: string, ek: number, seg: Segment) => `${area}:${ek}:${seg}`;
  const ensure = (area: 'sales' | 'csr', employeeKey: number, segment: Segment, agentName: string | null, departmentName: string | null): Acc => {
    const k = keyOf(area, employeeKey, segment);
    let row = acc.get(k);
    if (!row) {
      row = { area, employeeKey, segment, agentName, departmentName, beginning: 0, newAssigned: 0, touched: 0, closed: 0 };
      acc.set(k, row);
    }
    if (!row.agentName && agentName) row.agentName = agentName;
    if (!row.departmentName && departmentName) row.departmentName = departmentName;
    return row;
  };

  // Contact Manager beginning per (area, employee), folded from CRM via conform.
  const cmBeginByKey = new Map<string, number>();
  for (const r of cmBeginRows) {
    const c = conform.get(r.email);
    if (!c) continue;
    const k = `${c.area}:${c.employeeKey}`;
    cmBeginByKey.set(k, (cmBeginByKey.get(k) ?? 0) + r.count);
  }
  // Split each agent's bucket-total beginning: CM (capped at the total so CM +
  // other always equals the bucket, matching the Tickets & Tasks trend) and other.
  for (const b of beginRows) {
    const area = b.area === 'sales' ? 'sales' : 'csr';
    const employeeKey = Number(b.employeeKey);
    const agentName = (b.agentName as string | null) ?? null;
    const departmentName = (b.departmentName as string | null) ?? null;
    const total = Number(b.beginning);
    const cm = Math.min(cmBeginByKey.get(`${area}:${employeeKey}`) ?? 0, total);
    const other = total - cm;
    if (cm > 0) ensure(area, employeeKey, 'contact_manager', agentName, departmentName).beginning += cm;
    if (other > 0) ensure(area, employeeKey, 'other', agentName, departmentName).beginning += other;
  }
  const foldFlow = (flow: CrmFlowRow[], field: 'newAssigned' | 'touched' | 'closed') => {
    for (const f of flow) {
      const c = conform.get(f.email);
      if (!c) continue; // assignee not a conformed CSR agent -> excluded, like the live report
      ensure(c.area, c.employeeKey, f.segment, f.agentName, c.departmentName)[field] += f.count;
    }
  };
  foldFlow(newRows, 'newAssigned');
  foldFlow(touchedRows, 'touched');
  foldFlow(closedRows, 'closed');

  const values = [...acc.values()].filter((r) => r.beginning || r.newAssigned || r.touched || r.closed);
  if (values.length === 0) return { captured: true, rows: 0, reason: 'ok' };

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO ie_ticket_task_productivity_daily
       (snapshot_date, area, employee_key, segment, agent_name, department_name, beginning, new_assigned, touched, closed, is_backfilled)
     VALUES ${values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').join(', ')}
     ON DUPLICATE KEY UPDATE
       agent_name = VALUES(agent_name), department_name = VALUES(department_name),
       beginning = VALUES(beginning), new_assigned = VALUES(new_assigned),
       touched = VALUES(touched), closed = VALUES(closed)`,
    values.flatMap((r) => [day, r.area, r.employeeKey, r.segment, r.agentName, r.departmentName, r.beginning, r.newAssigned, r.touched, r.closed]),
  );
  return { captured: true, rows: result.affectedRows ?? values.length, reason: 'ok' };
}

// ── Leads (Phase 4) ─────────────────────────────────────────────────────────

export interface LeadsFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  /** Salesperson display names (ie_fact_lead.salesperson_name). */
  users?: string[];
  /** Department names (ie_dim_department.department_name). */
  departments?: string[];
  /**
   * When set (SELF data-scope), restrict every query — data AND dropdowns — to
   * this single conformed employee so a salesperson only ever sees their own
   * numbers. Resolved from ie_page_role_access via InsightsPermissionService.
   */
  selfEmployeeKey?: number | null;
}

export interface LeadCatSourceRow {
  category: string; source: string; totalLeads: number; conversions: number;
  pctConverted: number; bizDaysElapsed: number; leadPace: number; conversionPace: number;
}

export interface LeadsResult {
  businessDays: number;
  kpis: Record<string, number>;
  rows: LeadCatSourceRow[];
  availableUsers: string[];
  availableDepartments: string[];
  dataLastUpdated: string | null;
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

/**
 * Leads report data, rolled up by (lead source category, lead source) over the
 * selected created-date period. Leads/conversions are summed from the 0/1 fact
 * flags; pace projects each figure to the end of the period using the Business
 * Calendar (elapsed business days vs. total) — for a completed period elapsed ==
 * total so pace == actual; for the current month it projects to month-end. Same
 * sales-only guards as the other AA reports (CSR role + Sales Department - All
 * subtree, by the conformed salesperson). Empty if the fact isn't loaded yet.
 */
export async function getLeads(filters: LeadsFilters): Promise<LeadsResult> {
  const empty: LeadsResult = {
    businessDays: 0, kpis: {}, rows: [],
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_lead'))) return empty;

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);
  const todayKey = toDateKey(new Date());

  const EMP_JOIN = `JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key`;
  const DEPT_JOIN = `JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;
  const baseWhere = [
    'f.date_key BETWEEN ? AND ?',
    'e.role_name = ?',
    "(dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%'))",
    // Exclude the "Non-Sales" lead source category (e.g. Customer Service /
    // Maintenance leads) — they aren't sales leads. Uncategorized (NULL/'') leads
    // are kept, so the NULL-safe test must not drop them.
    "(f.lead_source_category IS NULL OR f.lead_source_category <> 'Non-Sales')",
  ];
  const baseParams: (string | number)[] = [fromKey, toKey, AGENT_ROLE, SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH];

  applySelfScope(baseWhere, baseParams, filters.selfEmployeeKey);

  const where = [...baseWhere];
  const params = [...baseParams];
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`f.salesperson_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const baseWhereSql = `WHERE ${baseWhere.join(' AND ')}`;

  // Pace basis from the Business Calendar. resolvePeriod caps an in-progress
  // period's range at today, so for pace we need the period's NATURAL end (e.g.
  // end of the calendar month) as the total. Elapsed is counted only through the
  // latest date that actually has loaded data (capped at today) so an unfinished
  // or not-yet-loaded day doesn't inflate the denominator and understate pace.
  // For a completed period (prior_*/custom) elapsed == total and pace == actual.
  const naturalEndKey = toDateKey(periodNaturalEnd(filters.period, current.start, current.end));
  const dataThroughKey = await dataThroughDateKey('ie_fact_lead', `${EMP_JOIN} ${DEPT_JOIN}`, whereSql, params, todayKey);
  const { bizElapsed, project } = await computePaceBasis(fromKey, naturalEndKey, dataThroughKey);

  const [catRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(f.lead_source_category, ''), 'Uncategorized') AS category,
            COALESCE(NULLIF(f.lead_source, ''), 'Unknown')               AS source,
            SUM(f.lead_total)           AS totalLeads,
            SUM(f.lead_converted_total) AS conversions
     FROM ie_fact_lead f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereSql}
     GROUP BY category, source
     HAVING totalLeads > 0
     ORDER BY totalLeads DESC`,
    params,
  );

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.salesperson_name
     FROM ie_fact_lead f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY f.salesperson_name`,
    baseParams,
  );

  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name
     FROM ie_fact_lead f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY dpt.department_name`,
    baseParams,
  );

  const schedule = await getReportSchedule('lead');

  const rows: LeadCatSourceRow[] = catRows.map((r) => {
    const totalLeads = Number(r.totalLeads);
    const conversions = Number(r.conversions);
    return {
      category: r.category as string,
      source: r.source as string,
      totalLeads,
      conversions,
      pctConverted: r1(div(conversions, totalLeads) * 100),
      bizDaysElapsed: bizElapsed,
      leadPace: project(totalLeads),
      conversionPace: project(conversions),
    };
  });

  const totalLeads = rows.reduce((s, r) => s + r.totalLeads, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);

  return {
    businessDays: bizElapsed,
    kpis: {
      aa_total_leads: totalLeads,
      aa_total_conversions: conversions,
      aa_conversion_rate: r1(div(conversions, totalLeads) * 100),
      aa_lead_pace: project(totalLeads),
      aa_conversion_pace: project(conversions),
      aa_business_days: bizElapsed,
    },
    rows,
    availableUsers: userRows.map((r) => r.salesperson_name as string).filter(Boolean),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}

// ── Sales Margin (Phase 5) ──────────────────────────────────────────────────

export interface MarginFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  /** Salesperson display names (ie_fact_order_margin.salesperson_name). */
  users?: string[];
  /** Department names (ie_dim_department.department_name). */
  departments?: string[];
  /**
   * When set (SELF data-scope), restrict every query — data AND dropdowns — to
   * this single conformed employee so a salesperson only ever sees their own
   * numbers. Resolved from ie_page_role_access via InsightsPermissionService.
   */
  selfEmployeeKey?: number | null;
}

export interface MarginLeadsRow { agent: string; totalLeads: number; totalConversions: number; conversionPct: number }
export interface MarginDealsRow {
  agent: string; deals: number; totalSubs: number; subPace: number;
  subOnlyDeals: number; subOnly: number; subOnlyPct: number;
}
export interface MarginRow {
  agent: string; product: number; install: number; shipping: number; warranty: number;
  total: number; pace: number; perDeal: number; perSub: number; warrantyPct: number; shippingPct: number;
}
export interface MarginCustomerRow {
  agent: string; customer: string; product: number; install: number; shipping: number;
  warranty: number; total: number; deals: number; subs: number;
}

export interface MarginResult {
  leads: MarginLeadsRow[];
  deals: MarginDealsRow[];
  margin: MarginRow[];
  customers: MarginCustomerRow[];
  /** Business days with data so far (the pace denominator) for the current period. */
  businessDaysElapsed: number;
  /** Total business days in the current period (the pace projection target). */
  businessDaysTotal: number;
  /** Latest date that actually has margin data (ISO YYYY-MM-DD); null when empty. */
  dataThroughDate: string | null;
  /** Business days in the full natural prior period (e.g. entire previous month). */
  priorBusinessDays: number;
  /** Selected current period range, formatted MM-DD-YYYY for display. */
  currentDateRange: { start: string; end: string } | null;
  /** Full natural prior period range, formatted MM-DD-YYYY for display. */
  priorDateRange: { start: string; end: string } | null;
  availableUsers: string[];
  availableDepartments: string[];
  dataLastUpdated: string | null;
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

/** Top N customers shown on the margin leaderboard (page caps at 50). */
const MARGIN_CUSTOMER_LIMIT = 50;

/**
 * Sales Margin report data — four tables for the selected period:
 *   1. Leads by Salesperson — reuses ie_fact_lead by created date (Non-Sales
 *      excluded), so it stays consistent with the Leads page.
 *   2. Deals & Subscriptions by Salesperson — by margin-eligibility date.
 *   3. Margin by Salesperson — product/install/shipping/warranty + pace.
 *   4. Margin by Customer leaderboard — top customers by total margin.
 * Margin rows are at (order, refund) grain so refunds net out as negative
 * margin / sub counts. Pace projects margin-eligibility figures to the period's
 * natural end via the Business Calendar (actual for completed periods). Same
 * sales-only guards as the other AA reports (CSR role + Sales Department - All
 * subtree, by the conformed salesperson). Empty if the fact isn't loaded yet.
 */
export async function getMargin(filters: MarginFilters): Promise<MarginResult> {
  const empty: MarginResult = {
    leads: [], deals: [], margin: [], customers: [],
    businessDaysElapsed: 0, businessDaysTotal: 0, dataThroughDate: null,
    priorBusinessDays: 0, currentDateRange: null, priorDateRange: null,
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_order_margin'))) return empty;

  const { current, prior } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);
  const todayKey = toDateKey(new Date());
  const naturalEndKey = toDateKey(periodNaturalEnd(filters.period, current.start, current.end));

  const EMP_JOIN = `JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key`;
  const DEPT_JOIN = `JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;
  const baseWhere = [
    'f.date_key BETWEEN ? AND ?',
    'e.role_name = ?',
    "(dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%'))",
  ];
  const baseParams: (string | number)[] = [fromKey, toKey, AGENT_ROLE, SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH];

  applySelfScope(baseWhere, baseParams, filters.selfEmployeeKey);

  const where = [...baseWhere];
  const params = [...baseParams];
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  if (filters.users?.length) {
    where.push(`f.salesperson_name IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const baseWhereSql = `WHERE ${baseWhere.join(' AND ')}`;

  // Pace basis (see getLeads): total business days run to the period's natural
  // end, while elapsed only counts business days through the latest date that
  // actually has margin data (capped at today), so an unfinished or not-yet-loaded
  // day never drags pace down. Completed periods -> elapsed == total -> pace == actual.
  const dataThroughKey = await dataThroughDateKey(
    'ie_fact_order_margin', `${EMP_JOIN} ${DEPT_JOIN}`, whereSql, params, todayKey);
  const { bizTotal, bizElapsed, project } = await computePaceBasis(fromKey, naturalEndKey, dataThroughKey);

  // Business Days comparison shown in the filter bar: current = elapsed-so-far,
  // prior = the FULL natural prior period (e.g. entire previous month).
  const priorRange = priorNaturalRange(filters.period, current.start, prior);
  const priorEndKey = toDateKey(priorRange.end);
  const { bizTotal: priorBusinessDays } = await computePaceBasis(
    toDateKey(priorRange.start), priorEndKey, priorEndKey);

  // Tables 2 + 3 — per salesperson. A "deal" is an order row (refund_id = 0);
  // returns are negative-margin/sub rows that net into the sums.
  const [spRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.salesperson_name AS agent,
            SUM(f.refund_id = 0)                       AS deals,
            SUM(f.order_sub_count)                     AS totalSubs,
            SUM(f.refund_id = 0 AND f.sub_only = 1)    AS subOnlyDeals,
            SUM(f.order_sub_count_sub_only)            AS subOnly,
            SUM(f.product_margin)                      AS product,
            SUM(f.install_margin)                      AS install,
            SUM(f.shipping_margin)                     AS shipping,
            SUM(f.warranty_margin)                     AS warranty,
            SUM(f.total_margin)                        AS total
     FROM ie_fact_order_margin f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereSql}
     GROUP BY f.salesperson_name
     ORDER BY f.salesperson_name`,
    params,
  );

  // Table 4 — per (salesperson, customer), top customers by total margin.
  const [custRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.salesperson_name AS agent, f.customer_name AS customer,
            SUM(f.product_margin)  AS product,
            SUM(f.install_margin)  AS install,
            SUM(f.shipping_margin) AS shipping,
            SUM(f.warranty_margin) AS warranty,
            SUM(f.total_margin)    AS total,
            SUM(f.refund_id = 0)   AS deals,
            SUM(f.order_sub_count) AS subs
     FROM ie_fact_order_margin f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${whereSql}
       AND f.order_id > 0
     GROUP BY f.salesperson_name, f.customer_name
     ORDER BY total DESC
     LIMIT ${MARGIN_CUSTOMER_LIMIT}`,
    params,
  );

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.salesperson_name
     FROM ie_fact_order_margin f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY f.salesperson_name`,
    baseParams,
  );

  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name
     FROM ie_fact_order_margin f
     ${EMP_JOIN}
     ${DEPT_JOIN}
     ${baseWhereSql}
     ORDER BY dpt.department_name`,
    baseParams,
  );

  const schedule = await getReportSchedule('order_margin');

  // Table 1 — Leads by Salesperson, from ie_fact_lead over the same period and
  // the same user/department filters (Non-Sales category excluded, like the
  // Leads page). Reuses `params` since the predicate columns match both facts.
  let leads: MarginLeadsRow[] = [];
  if (await factTableExists('ie_fact_lead')) {
    const leadWhereSql = `WHERE ${[...where,
      "(f.lead_source_category IS NULL OR f.lead_source_category <> 'Non-Sales')"].join(' AND ')}`;
    const [leadRows] = await pool.query<RowDataPacket[]>(
      `SELECT f.salesperson_name AS agent,
              SUM(f.lead_total)           AS totalLeads,
              SUM(f.lead_converted_total) AS totalConversions
       FROM ie_fact_lead f
       ${EMP_JOIN}
       ${DEPT_JOIN}
       ${leadWhereSql}
       GROUP BY f.salesperson_name
       HAVING totalLeads > 0
       ORDER BY f.salesperson_name`,
      params,
    );
    leads = leadRows.map((r) => {
      const totalLeads = Number(r.totalLeads);
      const totalConversions = Number(r.totalConversions);
      return { agent: r.agent, totalLeads, totalConversions, conversionPct: r1(div(totalConversions, totalLeads) * 100) };
    });
  }

  const deals: MarginDealsRow[] = spRows.map((r) => {
    const totalSubs = Number(r.totalSubs) || 0;
    const subOnly = Number(r.subOnly) || 0;
    return {
      agent: r.agent,
      deals: Number(r.deals) || 0,
      totalSubs,
      subPace: project(totalSubs),
      subOnlyDeals: Number(r.subOnlyDeals) || 0,
      subOnly,
      subOnlyPct: r1(div(subOnly, totalSubs) * 100),
    };
  });

  const margin: MarginRow[] = spRows.map((r) => {
    const product = r2(Number(r.product) || 0);
    const install = r2(Number(r.install) || 0);
    const shipping = r2(Number(r.shipping) || 0);
    const warranty = r2(Number(r.warranty) || 0);
    const total = r2(Number(r.total) || 0);
    const deals = Number(r.deals) || 0;
    const totalSubs = Number(r.totalSubs) || 0;
    return {
      agent: r.agent, product, install, shipping, warranty, total,
      pace: project(total),
      perDeal: r2(div(total, deals)),
      perSub: r2(div(total, totalSubs)),
      warrantyPct: Math.round(div(warranty, total) * 100),
      shippingPct: Math.round(div(shipping, total) * 100),
    };
  });

  const customers: MarginCustomerRow[] = custRows.map((r) => ({
    agent: r.agent,
    customer: r.customer ?? '',
    product: r2(Number(r.product) || 0),
    install: r2(Number(r.install) || 0),
    shipping: r2(Number(r.shipping) || 0),
    warranty: r2(Number(r.warranty) || 0),
    total: r2(Number(r.total) || 0),
    deals: Number(r.deals) || 0,
    subs: Number(r.subs) || 0,
  }));

  return {
    leads,
    deals,
    margin,
    customers,
    businessDaysElapsed: bizElapsed,
    businessDaysTotal: bizTotal,
    dataThroughDate: dateKeyToIso(dataThroughKey),
    priorBusinessDays,
    currentDateRange: { start: fmtMDY(current.start), end: fmtMDY(current.end) },
    priorDateRange: { start: fmtMDY(priorRange.start), end: fmtMDY(priorRange.end) },
    availableUsers: userRows.map((r) => r.salesperson_name as string).filter(Boolean),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}
