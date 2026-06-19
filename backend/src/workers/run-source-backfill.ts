import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of cwd
// (same pattern as run-source-dispatch.ts and the other run-* entrypoints).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import logger from '../config/logger';
import { SourceReportSyncWorker, SourceReportConfig } from './SourceReportSyncWorker';

const SERVICE = 'SourceReportBackfill';

/**
 * One-time / on-demand backfill for a source report over an explicit historical
 * range, run in fixed-size day chunks so each extract clears the engine's
 * per-statement timeout. The transform's delete-window+insert is idempotent per
 * chunk, so re-running a range is always safe.
 *
 * Usage:
 *   ts-node run-source-backfill.ts <report_code> <from YYYY-MM-DD> <to YYYY-MM-DD> [chunkDays=10]
 *
 * Example (Phase 2 backfill to start of 2026):
 *   ts-node run-source-backfill.ts call_activity 2026-01-01 2026-06-18 10
 */
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

async function loadConfig(reportCode: string): Promise<SourceReportConfig | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, report_code, report_name, source_pool, extract_sql_file, transform_sql_file,
            staging_table, target_fact_table, load_mode, window_months, incremental_days
     FROM ie_source_report WHERE report_code = ? LIMIT 1`,
    [reportCode],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, report_code: r.report_code, report_name: r.report_name, source_pool: r.source_pool,
    extract_sql_file: r.extract_sql_file, transform_sql_file: r.transform_sql_file,
    staging_table: r.staging_table, target_fact_table: r.target_fact_table, load_mode: r.load_mode,
    window_months: Number(r.window_months), incremental_days: Number(r.incremental_days),
  };
}

async function main(): Promise<void> {
  const [reportCode, fromStr, toStr, chunkStr] = process.argv.slice(2);
  if (!reportCode || !fromStr || !toStr) {
    logger.error('Usage: run-source-backfill <report_code> <from YYYY-MM-DD> <to YYYY-MM-DD> [chunkDays]', { service: SERVICE });
    process.exit(2);
  }
  const chunkDays = Math.max(1, Number(chunkStr) || 10);

  const cfg = await loadConfig(reportCode);
  if (!cfg) {
    logger.error('No ie_source_report row for report_code', { service: SERVICE, reportCode });
    process.exit(2);
    return;
  }

  const start = new Date(`${fromStr}T00:00:00`);
  const end = new Date(`${toStr}T00:00:00`);
  logger.info('Backfill starting', { service: SERVICE, report: reportCode, from: fromStr, to: toStr, chunkDays });

  let cursor = start;
  let totalRows = 0;
  while (cursor.getTime() <= end.getTime()) {
    const chunkEnd = new Date(Math.min(addDays(cursor, chunkDays - 1).getTime(), end.getTime()));
    const window = { pFromDate: fmt(cursor), pToDate: fmt(chunkEnd), pMonths: cfg.window_months };
    const res = await new SourceReportSyncWorker(cfg, window).run();
    totalRows += res?.rowsExtracted ?? 0;
    logger.info('Backfill chunk complete', {
      service: SERVICE, report: reportCode, from: window.pFromDate, to: window.pToDate,
      rowsExtracted: res?.rowsExtracted ?? 0, rowsLoaded: res?.rowsLoaded ?? 0,
    });
    cursor = addDays(chunkEnd, 1);
  }

  logger.info('Backfill complete', { service: SERVICE, report: reportCode, totalRowsExtracted: totalRows });
}

main().then(() => process.exit(0)).catch((err) => {
  logger.error('Backfill failed', { service: SERVICE, error: err?.message });
  process.exit(1);
});
