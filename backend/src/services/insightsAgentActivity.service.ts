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
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { resolvePeriod } from '../utils/periodUtils';

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
 * frontend can localize. mysql2 parses DATETIME columns into JS Date objects in
 * the Node process timezone (same tz the DB writes NOW()/CURRENT_TIMESTAMP in),
 * so `.toISOString()` yields the correct instant. Do NOT format these in SQL
 * with a literal 'Z' — that mislabels the local wall-clock as UTC and the
 * frontend then shifts it by the offset (the ~4h-off "Data last updated" bug).
 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Scheduling info for a report, used to power the "next update" tooltip on the
 * freshness stamp. `nextUpdate` is emitted in the same ISO-8601 UTC shape as
 * `dataLastUpdated` so the frontend converts both to local time identically.
 * Null-safe: returns nulls if the report isn't registered.
 */
export interface ReportSchedule {
  dataNextUpdate: string | null;
  updateEveryMinutes: number | null;
}

export async function getReportSchedule(reportCode: string): Promise<ReportSchedule> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT frequency_minutes, next_run_at AS nextRun
     FROM ie_source_report WHERE report_code = ? AND is_active = 1 LIMIT 1`,
    [reportCode],
  );
  const r = rows[0];
  return {
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

  const [freshRows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(loaded_at) AS last FROM ie_fact_email_activity`,
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
    dataLastUpdated: toIso(freshRows[0]?.last),
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

  // Base predicate: Inbound/Outbound only, in-period, CSR role, sales subtree.
  const EMP_JOIN = `JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key`;
  const DEPT_JOIN = `JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;
  const DATE_JOIN = `JOIN ie_dim_date d ON d.date_key = f.date_key`;
  const baseWhere = [
    "f.call_direction IN ('Inbound', 'Outbound')",
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

  const [freshRows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(loaded_at) AS last FROM ie_fact_call_activity`,
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
    dataLastUpdated: toIso(freshRows[0]?.last),
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
 * they stay accurate between snapshot runs. Same sales-only guards as the other
 * AA reports (CSR role + Sales Department - All subtree, by the conformed
 * assignee). Degrades to empty if the fact table isn't loaded yet.
 */
export async function getTicketsTasks(filters: TicketTaskFilters): Promise<TicketsTasksResult> {
  const empty: TicketsTasksResult = {
    groups: [], grandTotal: { current: 0, dueToday: 0, pastDue: 0 },
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_ticket_task'))) return empty;

  const EMP_JOIN = `JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key`;
  const DEPT_JOIN = `JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;
  // Bucket = next_contact (the task/ticket DueOn) vs today. NULL due date -> no
  // bucket (matches the legacy proc's PastDueCurrent CASE with no ELSE).
  const CUR = `SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) > CURDATE())`;
  const DUE = `SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) = CURDATE())`;
  const PAST = `SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) < CURDATE())`;

  const baseWhere = [
    'e.role_name = ?',
    "(dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%'))",
  ];
  const baseParams: (string | number)[] = [AGENT_ROLE, SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH];

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

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name AS agent, dpt.department_name AS department, f.classification AS classification,
            ${CUR} AS cur, ${DUE} AS dueToday, ${PAST} AS pastDue
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

  const [freshRows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(loaded_at) AS last FROM ie_fact_ticket_task`,
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
    dataLastUpdated: toIso(freshRows[0]?.last),
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
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

  // Pace basis from the Business Calendar. resolvePeriod caps an in-progress
  // period's range at today, so for pace we need the period's NATURAL end (e.g.
  // end of the calendar month) as the total, while elapsed stays the business
  // days already worked (<= today). For a completed period (prior_*/custom) the
  // natural end equals the range end, so elapsed == total and pace == actual.
  const naturalEndKey = toDateKey(periodNaturalEnd(filters.period, current.start, current.end));
  const [bizRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(date_key <= ?) AS elapsed
     FROM ie_dim_date
     WHERE is_business_day = 1 AND date_key BETWEEN ? AND ?`,
    [todayKey, fromKey, naturalEndKey],
  );
  const bizTotal = Number(bizRows[0]?.total ?? 0);
  const bizElapsed = Math.max(1, Number(bizRows[0]?.elapsed ?? 0));
  const project = (v: number): number => Math.round(div(v, bizElapsed) * bizTotal);

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

  const [freshRows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(loaded_at) AS last FROM ie_fact_lead`,
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
    dataLastUpdated: toIso(freshRows[0]?.last),
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
    availableUsers: [], availableDepartments: [], dataLastUpdated: null,
    dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_order_margin'))) return empty;

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);
  const todayKey = toDateKey(new Date());

  // Pace basis from the Business Calendar (see getLeads): elapsed business days
  // (<= today) vs. the period's natural end. Completed period -> pace == actual.
  const naturalEndKey = toDateKey(periodNaturalEnd(filters.period, current.start, current.end));
  const [bizRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(date_key <= ?) AS elapsed
     FROM ie_dim_date
     WHERE is_business_day = 1 AND date_key BETWEEN ? AND ?`,
    [todayKey, fromKey, naturalEndKey],
  );
  const bizTotal = Number(bizRows[0]?.total ?? 0);
  const bizElapsed = Math.max(1, Number(bizRows[0]?.elapsed ?? 0));
  const project = (v: number): number => Math.round(div(v, bizElapsed) * bizTotal);

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

  const [freshRows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(loaded_at) AS last FROM ie_fact_order_margin`,
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
    availableUsers: userRows.map((r) => r.salesperson_name as string).filter(Boolean),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: toIso(freshRows[0]?.last),
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}
