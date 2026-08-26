/**
 * insightsCompanyReporting.service — read layer for the Company Reporting section.
 *
 * Service Counts is the first report: the conformed monthly per-segment grain from
 * ie_fact_service_counts (dissected sp_ReportServiceCountsByMonthByProviderByZoneType).
 * The service returns the RAW monthly series per segment plus the current-month
 * anchor; all breakout/detail math (churn, growth, roll-ups, windows) is computed
 * client-side by the existing report model, so there is a single source of truth
 * for the formulas and the API stays a thin data feed. Degrades to an empty result
 * (via factTableExists) before the fact table has been loaded.
 *
 * Hand-written SQL by design — this is the Insights data-warehouse read layer, which
 * is exempt from the Prisma mandate (see .cursor/rules/insights-data-warehouse.mdc).
 */
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { factTableExists, getDatasetFreshness, type ReportSchedule } from './insightsAgentActivity.service';

/** One month of a segment's flows. `eom` is the active base at end of month. */
export interface ServiceCountFlow {
  started: number;
  stopped: number;
  react: number;
  eom: number;
}

export interface ServiceCountsResult {
  /** 'YYYYMM' months, oldest → newest. */
  months: string[];
  /** Index of the latest (prior-day) month in `months`. -1 when empty. */
  currentIndex: number;
  /** True when the latest month is still in progress (as-of prior day). */
  isPartial: boolean;
  /** Per segment_key: flows parallel to `months`. */
  series: Record<string, ServiceCountFlow[]>;
  /**
   * Freshness stamp sourced from the ACTUAL last successful load in
   * ie_ingestion_log (via ie_dataset_monitor), not the schedule's next_run_at
   * bookkeeping — so it reflects backfills and shows immediately after the first
   * load rather than only after the nightly dispatcher reschedules the report.
   */
  schedule: ReportSchedule;
}

const EMPTY_SCHEDULE: ReportSchedule = { dataLastUpdated: null, dataNextUpdate: null, updateEveryMinutes: null };

/**
 * Is the given YYYYMM the current calendar month and not yet complete? Local-first
 * per date-handling rule — the "prior day" snapshot means an in-progress month is
 * flagged so the UI treats it as to-date, never a full-month rate basis.
 */
function isMonthInProgress(yyyymm: string): boolean {
  const year = Number(yyyymm.slice(0, 4));
  const month0 = Number(yyyymm.slice(4, 6)) - 1;
  const now = new Date();
  if (now.getFullYear() !== year || now.getMonth() !== month0) return false;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return now.getDate() < lastDay;
}

export async function getServiceCounts(): Promise<ServiceCountsResult> {
  if (!(await factTableExists('ie_fact_service_counts'))) {
    return { months: [], currentIndex: -1, isPartial: false, series: {}, schedule: EMPTY_SCHEDULE };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT \`year_month\` AS ym, segment_key AS seg,
            started, stopped, reactivated AS react, active_total AS eom
     FROM ie_fact_service_counts
     ORDER BY date_key ASC, segment_key ASC`,
  );

  const schedule = await getDatasetFreshness('service_counts');
  if (rows.length === 0) {
    return { months: [], currentIndex: -1, isPartial: false, series: {}, schedule };
  }

  // rows are date_key ASC, so first-seen order of year_month is oldest → newest.
  const months = [...new Set(rows.map((r) => String(r.ym)))];
  const idxByMonth = new Map(months.map((m, i) => [m, i]));
  const zero = (): ServiceCountFlow => ({ started: 0, stopped: 0, react: 0, eom: 0 });

  const series: Record<string, ServiceCountFlow[]> = {};
  for (const r of rows) {
    const seg = String(r.seg);
    if (!series[seg]) series[seg] = months.map(zero);
    const i = idxByMonth.get(String(r.ym))!;
    series[seg][i] = {
      started: Number(r.started),
      stopped: Number(r.stopped),
      react: Number(r.react),
      eom: Number(r.eom),
    };
  }

  const currentIndex = months.length - 1;
  return { months, currentIndex, isPartial: isMonthInProgress(months[currentIndex]), series, schedule };
}
