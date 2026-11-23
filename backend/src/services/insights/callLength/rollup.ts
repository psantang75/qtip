/**
 * Pure folding for the Call Length report: turns the two SQL group-bys into the
 * shapes each chart consumes. Kept free of DB access so the arithmetic — bucket
 * totals, per-department averages, share-of-time — is unit-testable without a
 * warehouse, and so the service stays a query layer.
 *
 * The reader issues only two aggregates, (department x band) and (agent x band),
 * and every view below is folded from them rather than costing another round
 * trip per chart.
 */
import { CALL_LENGTH_BANDS, LONG_BANDS, OVER_10_BANDS, zeroBands } from './bands';

/**
 * Call count and summed seconds for a group. After-call work is the time in two
 * statuses — Follow-Up Extended and Wrap Pending — and handle already includes
 * both.
 */
interface CallSecs {
  calls: number;
  talkSecs: number;
  wrapExtendedSecs: number;
  wrapPendingSecs: number;
  handleSecs: number;
}

/** One (department x band) aggregate row. */
export interface DeptAggRow extends CallSecs {
  department: string;
  band: string;
}

/** One (agent x band) aggregate row. */
export interface RepAggRow extends CallSecs {
  agent: string;
  department: string;
  band: string;
}

export interface BandTotal {
  key: string;
  label: string;
  calls: number;
  pctCalls: number;
  handleHours: number;
  /** The two after-call parts inside this bucket, charted against handleHours. */
  wrapExtendedHours: number;
  wrapPendingHours: number;
  /** Share of total handle time. Diverges sharply from pctCalls — that's the point. */
  pctTime: number;
  avgMin: number;
}
export interface DeptBandRow {
  department: string;
  calls: number;
  avgHandleMin: number;
  bands: Record<string, number>;
}
export interface RepBandRow {
  agent: string;
  department: string;
  calls: number;
  avgTalkMin: number;
  avgWrapMin: number;
  avgHandleMin: number;
  bands: Record<string, number>;
}

export interface BandRollup {
  byDept: DeptBandRow[];
  bandTotals: BandTotal[];
  totalCalls: number;
  totalHandleSecs: number;
  /** Both after-call parts. */
  totalWrapSecs: number;
  /**
   * Raw (unrounded) handle seconds per bucket. The KPIs derive from this rather
   * than from BandTotal.handleHours, which is rounded to one decimal for
   * display — re-summing those rounded hours drifts by whole percentage points
   * once several buckets are added together.
   */
  bandHandleSecs: Record<string, number>;
}

export const r1 = (n: number): number => Math.round(n * 10) / 10;
export const div = (a: number, b: number): number => (b ? a / b : 0);
/** Seconds -> minutes, one decimal. */
const toMin = (secs: number, calls: number) => r1(div(secs, calls) / 60);

const newAcc = (): CallSecs => ({
  calls: 0, talkSecs: 0, wrapExtendedSecs: 0, wrapPendingSecs: 0, handleSecs: 0,
});
function add(acc: CallSecs, r: CallSecs): void {
  acc.calls += r.calls;
  acc.talkSecs += r.talkSecs;
  acc.wrapExtendedSecs += r.wrapExtendedSecs;
  acc.wrapPendingSecs += r.wrapPendingSecs;
  acc.handleSecs += r.handleSecs;
}
const allWrapSecs = (a: CallSecs): number => a.wrapExtendedSecs + a.wrapPendingSecs;

/**
 * Fold the (department x band) grid into the per-department bucket matrix and
 * the overall bucket totals.
 */
export function rollupDepts(rows: DeptAggRow[]): BandRollup {
  const deptAcc = new Map<string, CallSecs & { bands: Record<string, number> }>();
  const bandAcc = new Map<string, CallSecs>();
  const total = newAcc();

  for (const r of rows) {
    const dept = r.department || '';

    if (!deptAcc.has(dept)) deptAcc.set(dept, { ...newAcc(), bands: zeroBands() });
    const d = deptAcc.get(dept)!;
    add(d, r);
    d.bands[r.band] = (d.bands[r.band] ?? 0) + r.calls;

    if (!bandAcc.has(r.band)) bandAcc.set(r.band, newAcc());
    add(bandAcc.get(r.band)!, r);

    add(total, r);
  }

  const byDept: DeptBandRow[] = [...deptAcc.entries()]
    .map(([department, d]) => ({
      department,
      calls: d.calls,
      avgHandleMin: toMin(d.handleSecs, d.calls),
      bands: d.bands,
    }))
    .sort((a, b) => b.calls - a.calls);

  const bandTotals: BandTotal[] = CALL_LENGTH_BANDS.map((def) => {
    const b = bandAcc.get(def.key) ?? newAcc();
    return {
      key: def.key,
      label: def.label,
      calls: b.calls,
      pctCalls: r1(div(b.calls, total.calls) * 100),
      handleHours: r1(b.handleSecs / 3600),
      wrapExtendedHours: r1(b.wrapExtendedSecs / 3600),
      wrapPendingHours: r1(b.wrapPendingSecs / 3600),
      pctTime: r1(div(b.handleSecs, total.handleSecs) * 100),
      avgMin: toMin(b.handleSecs, b.calls),
    };
  });

  return {
    byDept,
    bandTotals,
    totalCalls: total.calls,
    totalHandleSecs: total.handleSecs,
    totalWrapSecs: allWrapSecs(total),
    bandHandleSecs: Object.fromEntries(
      CALL_LENGTH_BANDS.map((def) => [def.key, bandAcc.get(def.key)?.handleSecs ?? 0]),
    ),
  };
}

/**
 * Fold the (agent x band) rows into one row per rep, grouped by department then
 * descending volume so the table reads department-by-department.
 */
export function rollupReps(rows: RepAggRow[]): RepBandRow[] {
  const acc = new Map<string, CallSecs & { department: string; bands: Record<string, number> }>();
  for (const r of rows) {
    const agent = r.agent || '';
    if (!acc.has(agent)) {
      acc.set(agent, { ...newAcc(), department: r.department || '', bands: zeroBands() });
    }
    const rep = acc.get(agent)!;
    add(rep, r);
    rep.bands[r.band] = (rep.bands[r.band] ?? 0) + r.calls;
  }
  return [...acc.entries()]
    .map(([agent, rep]) => ({
      agent,
      department: rep.department,
      calls: rep.calls,
      avgTalkMin: toMin(rep.talkSecs, rep.calls),
      avgWrapMin: toMin(allWrapSecs(rep), rep.calls),
      avgHandleMin: toMin(rep.handleSecs, rep.calls),
      bands: rep.bands,
    }))
    .sort((a, b) => (a.department === b.department
      ? b.calls - a.calls
      : a.department.localeCompare(b.department)));
}

/**
 * The KPI row. `pct_time_long` is share of HANDLE TIME in the 5-minute-plus
 * buckets rather than share of calls — the two diverge sharply (measured: 18.6%
 * of calls but 48.5% of hours), and the time figure is the one that sizes the
 * opportunity.
 */
export function buildKpis(roll: BandRollup): Record<string, number> {
  const sumCalls = (keys: string[]) =>
    roll.bandTotals.filter((b) => keys.includes(b.key)).reduce((s, b) => s + b.calls, 0);
  const sumSecs = (keys: string[]) =>
    keys.reduce((s, k) => s + (roll.bandHandleSecs[k] ?? 0), 0);

  return {
    csr_cl_total_calls: roll.totalCalls,
    csr_cl_handle_hours: r1(roll.totalHandleSecs / 3600),
    csr_cl_avg_handle: toMin(roll.totalHandleSecs, roll.totalCalls),
    csr_cl_calls_over_10: sumCalls(OVER_10_BANDS),
    csr_cl_pct_time_long: r1(div(sumSecs(LONG_BANDS), roll.totalHandleSecs) * 100),
    csr_cl_wrap_share: r1(div(roll.totalWrapSecs, roll.totalHandleSecs) * 100),
  };
}
