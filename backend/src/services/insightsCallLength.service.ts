/**
 * Insights → Agent Activity - CSR → Call Length.
 *
 * Handle-time DISTRIBUTION over ie_fact_support_call (call grain). It cannot
 * read ie_fact_call_activity: that fact is a daily (agent x direction) roll-up
 * with no per-call row to bucket.
 *
 * "Length" is total handle time — talk + hold + wrap — because that is what the
 * business pays per call. The components come back alongside the buckets so
 * wrap can be read on its own: on measured support traffic wrap is ~26% of all
 * handle time, and roughly half of calls end on the Genesys wrap-up TIMEOUT
 * code carrying ~90s of wrap against ~17s when the agent actually dispositions
 * the call. So a large slice of "handle time" is the wrap-up screen timing out
 * rather than customer contact, and `wrapTimeoutPct` surfaces exactly that.
 *
 * Scope mirrors the sibling CSR readers (CSR role + the complement of the Sales
 * Department - All subtree, via insightsAgentScope) so the agent population
 * cannot drift from Call Activity sitting directly above it in the sidebar.
 *
 * ALL directions are included, Internal among them: an internal consult or
 * transfer leg is real handle time on a support call, and dropping it would
 * understate the long tail this report exists to find.
 *
 * Bucket arithmetic lives in insights/callLength/rollup.ts; this file is the
 * query layer.
 */
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { resolvePeriod } from '../utils/periodUtils';
import { factTableExists, getReportSchedule } from './insightsAgentActivity.service';
import { CALL_LENGTH_BANDS, bandCaseSql, WRAP_TIMEOUT_CODE, type CallLengthBand } from './insights/callLength/bands';
import { supportCallScope, whereSql as toWhereSql } from './insights/callLength/scope';
import {
  rollupDepts, rollupReps, buildKpis, r1, div,
  type BandTotal, type DeptAggRow, type DeptBandRow, type RepAggRow, type RepBandRow,
} from './insights/callLength/rollup';

export type { BandTotal, DeptBandRow, RepBandRow };

export interface CallLengthFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  /** Agent display names (ie_fact_support_call.agent_name). */
  users?: string[];
  departments?: string[];
  /** Set for a SELF-scoped viewer; pins every query to that one employee. */
  selfEmployeeKey?: number | null;
}

export interface CallLengthResult {
  bands: readonly CallLengthBand[];
  /** Departments present, highest volume first — the chart series order. */
  departments: string[];
  kpis: Record<string, number>;
  bandTotals: BandTotal[];
  byDept: DeptBandRow[];
  byRep: RepBandRow[];
  /** Share of calls whose wrap-up code timed out instead of being set. */
  wrapTimeoutPct: number;
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

export async function getCallLength(filters: CallLengthFilters): Promise<CallLengthResult> {
  const empty: CallLengthResult = {
    bands: CALL_LENGTH_BANDS, departments: [], kpis: {}, bandTotals: [], byDept: [],
    byRep: [], wrapTimeoutPct: 0, availableUsers: [], availableDepartments: [],
    dataLastUpdated: null, dataNextUpdate: null, updateEveryMinutes: null,
  };
  if (!(await factTableExists('ie_fact_support_call'))) return empty;

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);

  // Shared with the Call Transcripts on-demand report so a download can never
  // cover a call this page wouldn't count.
  const scope = supportCallScope({
    fromKey, toKey,
    selfEmployeeKey: filters.selfEmployeeKey,
    departments: filters.departments,
    users: filters.users,
  });
  const JOINS = scope.joins;
  const params = scope.layered.params;
  const baseParams = scope.base.params;
  const whereSql = toWhereSql(scope.layered);
  const baseWhereSql = toWhereSql(scope.base);
  const BAND = bandCaseSql();
  const MEASURES = `COUNT(*) AS calls,
            SUM(f.talk_secs)   AS talkSecs,
            SUM(f.wrap_secs)   AS wrapSecs,
            SUM(f.handle_secs) AS handleSecs`;

  // Two aggregates only: (department x band) powers the bucket charts and the
  // department mix; (agent x band) powers the per-rep table. The report reads
  // a whole period at once and has no daily series, so nothing groups by date.
  const [bandRows] = await pool.query<RowDataPacket[]>(
    `SELECT dpt.department_name AS department, ${BAND} AS band, ${MEASURES}
     FROM ie_fact_support_call f
     ${JOINS}
     ${whereSql}
     GROUP BY dpt.department_name, band`,
    params,
  );

  const [repRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name AS agent, dpt.department_name AS department, ${BAND} AS band, ${MEASURES}
     FROM ie_fact_support_call f
     ${JOINS}
     ${whereSql}
     GROUP BY f.agent_name, dpt.department_name, band
     ORDER BY dpt.department_name, f.agent_name`,
    params,
  );

  const [timeoutRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN f.wrap_up_code = ? THEN 1 ELSE 0 END) AS timedOut
     FROM ie_fact_support_call f
     ${JOINS}
     ${whereSql}`,
    [WRAP_TIMEOUT_CODE, ...params],
  );

  // Filter-bar options read the BASE predicate, so picking one agent never
  // removes the others from the dropdown.
  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.agent_name FROM ie_fact_support_call f
     ${JOINS} ${baseWhereSql} ORDER BY f.agent_name`,
    baseParams,
  );
  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name FROM ie_fact_support_call f
     ${JOINS} ${baseWhereSql} ORDER BY dpt.department_name`,
    baseParams,
  );

  const schedule = await getReportSchedule('support_call');

  const toNum = (v: unknown) => Number(v ?? 0);
  const roll = rollupDepts(bandRows.map((r): DeptAggRow => ({
    department: (r.department as string) ?? '',
    band: String(r.band),
    calls: toNum(r.calls),
    talkSecs: toNum(r.talkSecs),
    wrapSecs: toNum(r.wrapSecs),
    handleSecs: toNum(r.handleSecs),
  })));

  const byRep = rollupReps(repRows.map((r): RepAggRow => ({
    agent: (r.agent as string) ?? '',
    department: (r.department as string) ?? '',
    band: String(r.band),
    calls: toNum(r.calls),
    talkSecs: toNum(r.talkSecs),
    wrapSecs: toNum(r.wrapSecs),
    handleSecs: toNum(r.handleSecs),
  })));

  return {
    bands: CALL_LENGTH_BANDS,
    departments: roll.byDept.map((d) => d.department),
    kpis: buildKpis(roll),
    bandTotals: roll.bandTotals,
    byDept: roll.byDept,
    byRep,
    wrapTimeoutPct: r1(div(toNum(timeoutRows[0]?.timedOut), toNum(timeoutRows[0]?.n)) * 100),
    availableUsers: userRows.map((r) => r.agent_name as string),
    availableDepartments: deptRows.map((r) => r.department_name as string),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}
