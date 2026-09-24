import { SourceReportSyncWorker, SourceReportConfig } from './SourceReportSyncWorker';
import { DeskTimeSyncWorker, type DeskTimeRequest } from './DeskTimeSyncWorker';
import type { WorkerResult } from './BaseInsightsWorker';
import { deskTimeService } from '../services/desktime/DeskTimeService';
import { businessNow } from '../services/insightsAgentActivity.service';

/**
 * ie_source_report rows fed by an HTTP API instead of a SQL extract. They sit
 * in the same registry so Report Schedules owns their cadence and Run now, but
 * the SQL-only columns (source_pool, extract_sql_file, staging_table) are not
 * read for them. `incremental_days` is how many ET days back each run re-pulls.
 */
const API_RUNNERS: Record<string, (cfg: SourceReportConfig) => Promise<WorkerResult | null>> = {
  desktime_daily: runDeskTime,
};

export function isApiSourceReport(reportCode: string): boolean {
  return reportCode in API_RUNNERS;
}

/** Run one registry row with the worker that owns it. Dispatcher and Run now both use this. */
export function runSourceReport(cfg: SourceReportConfig): Promise<WorkerResult | null> {
  const api = API_RUNNERS[cfg.report_code];
  return api ? api(cfg) : new SourceReportSyncWorker(cfg).run();
}

/** The last `days` ET calendar days, oldest first (today included). */
export function recentBusinessDays(days: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = Math.max(1, days) - 1; i >= 0; i--) {
    out.push(businessNow(new Date(now.getTime() - i * 86_400_000)).date);
  }
  return out;
}

async function runDeskTime(cfg: SourceReportConfig): Promise<WorkerResult | null> {
  if (!deskTimeService.isConfigured()) throw new Error('DESKTIME_API_KEY is not set');
  const requests: DeskTimeRequest[] = recentBusinessDays(cfg.incremental_days).map((date) => ({ date, period: 'day' }));
  return new DeskTimeSyncWorker(requests).run();
}
