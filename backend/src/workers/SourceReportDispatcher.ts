import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import logger from '../config/logger';
import { SourceReportSyncWorker, SourceReportConfig } from './SourceReportSyncWorker';
import { notifyIngestionFailure } from '../services/notifications/ingestionAlerts';

const SERVICE = 'SourceReportDispatcher';

/**
 * DB-driven scheduler for source-report ingestion.
 *
 * Invoked on a fixed floor by the single PM2 app `ie-source-dispatch`. Each tick
 * it picks up every active report whose `next_run_at` is due (and whose
 * optional `run_only_hours` off-peak window includes the current hour), runs it
 * via SourceReportSyncWorker, and reschedules it `frequency_minutes` later.
 *
 * Cadence is pure data: edit the ie_source_report row to retune a report — no
 * code change, no redeploy. A failure in one report is isolated; the rest of
 * the due set still runs.
 */
export class SourceReportDispatcher {
  async run(): Promise<void> {
    const due = await this.loadDueReports();
    if (due.length === 0) {
      logger.info('No source reports due', { service: SERVICE });
      return;
    }

    logger.info('Dispatching source reports', {
      service: SERVICE, count: due.length, reports: due.map((r) => r.report_code),
    });

    for (const cfg of due) {
      let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
      try {
        await new SourceReportSyncWorker(cfg).run();
      } catch (err: any) {
        status = 'FAILED';
        logger.error('Source report run failed', {
          service: SERVICE, report: cfg.report_code, error: err?.message,
        });
        await notifyIngestionFailure({
          channel: 'sql',
          name: cfg.report_name,
          code: cfg.report_code,
          reason: err?.message ?? 'Report run failed',
        });
      }
      await this.reschedule(cfg.id, status);
    }
  }

  private async loadDueReports(): Promise<SourceReportConfig[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, report_code, report_name, source_pool, extract_sql_file, transform_sql_file,
              staging_table, target_fact_table, load_mode, window_months, incremental_days,
              run_only_hours
       FROM ie_source_report
       WHERE is_active = 1
         AND (next_run_at IS NULL OR next_run_at <= NOW())
       ORDER BY next_run_at IS NULL DESC, next_run_at ASC`,
    );

    const currentHour = new Date().getHours();
    return rows
      .filter((r) => hourInWindow(currentHour, r.run_only_hours as string | null))
      .map((r) => ({
        id: r.id,
        report_code: r.report_code,
        report_name: r.report_name,
        source_pool: r.source_pool,
        extract_sql_file: r.extract_sql_file,
        transform_sql_file: r.transform_sql_file,
        staging_table: r.staging_table,
        target_fact_table: r.target_fact_table,
        load_mode: r.load_mode,
        window_months: Number(r.window_months),
        incremental_days: Number(r.incremental_days),
      }));
  }

  private async reschedule(id: number, status: 'SUCCESS' | 'FAILED'): Promise<void> {
    await pool.execute(
      `UPDATE ie_source_report
       SET last_run_at = NOW(),
           next_run_at = DATE_ADD(NOW(), INTERVAL frequency_minutes MINUTE),
           last_status = ?
       WHERE id = ?`,
      [status, id],
    );
  }
}

/**
 * Is `hour` inside an inclusive `H1-H2` window? Supports wrap-around
 * (e.g. '22-3' = 22:00..03:59). NULL/blank means "any hour".
 */
function hourInWindow(hour: number, window: string | null): boolean {
  if (!window) return true;
  const m = window.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return true;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;
}
