/**
 * Cycle Performance is one page built from five facts. Those facts are not
 * independent: the invoice transform joins tasks, and recovery joins invoice,
 * task and touch. Running any of them alone — or in the wrong order — is how
 * the page's numbers came to depend on who clicked what.
 *
 * Every path that would have run a member (admin Run now, the dispatcher, a
 * backfill of a single code) goes through `runCyclePipeline` instead. The five
 * always load in `CYCLE_LOAD_ORDER`, and a failure stops the rest so a later
 * fact cannot be rebuilt on a predecessor that did not finish.
 */
import os from 'os';
import type { RowDataPacket } from 'mysql2';
import pool from '../../../config/database';
import logger from '../../../config/logger';
import { SourceReportSyncWorker, type SourceReportConfig } from '../../../workers/SourceReportSyncWorker';
import { notifyIngestionFailure } from '../../notifications/ingestionAlerts';

const SERVICE = 'CyclePipeline';
export const CYCLE_LOCK_NAME = 'source-collections-cycle';

/**
 * Load order. Later facts join earlier ones — do not reorder without reading
 * collections_invoice.transform.sql and collections_recovery.transform.sql.
 */
export const CYCLE_LOAD_ORDER = [
  'collections_task',
  'collections_invoice',
  'collections_billing',
  'collections_touch',
  'collections_recovery',
] as const;

export type CyclePipelineCode = (typeof CYCLE_LOAD_ORDER)[number];

export function isCyclePipelineCode(code: string): code is CyclePipelineCode {
  return (CYCLE_LOAD_ORDER as readonly string[]).includes(code);
}

/** Pull the five cycle members out of a due set so the dispatcher runs them once. */
export function splitCycleDue<T extends { report_code: string }>(due: T[]): {
  runCycle: boolean;
  rest: T[];
} {
  return {
    runCycle: due.some((r) => isCyclePipelineCode(r.report_code)),
    rest: due.filter((r) => !isCyclePipelineCode(r.report_code)),
  };
}

export interface CyclePipelineStep {
  code: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error?: string;
}

export interface CyclePipelineResult {
  status: 'SUCCESS' | 'FAILED' | 'BUSY';
  steps: CyclePipelineStep[];
}

const CFG_SQL = `
  SELECT id, report_code, report_name, source_pool, extract_sql_file, transform_sql_file,
         staging_table, target_fact_table, load_mode, window_months, incremental_days
    FROM ie_source_report
   WHERE report_code IN (${CYCLE_LOAD_ORDER.map(() => '?').join(',')})`;

function toConfig(r: RowDataPacket): SourceReportConfig {
  return {
    id: Number(r.id),
    report_code: String(r.report_code),
    report_name: String(r.report_name),
    source_pool: r.source_pool,
    extract_sql_file: String(r.extract_sql_file),
    transform_sql_file: (r.transform_sql_file as string | null) ?? null,
    staging_table: String(r.staging_table),
    target_fact_table: String(r.target_fact_table),
    load_mode: r.load_mode,
    window_months: Number(r.window_months),
    incremental_days: Number(r.incremental_days),
  };
}

async function loadConfigs(): Promise<SourceReportConfig[]> {
  const [rows] = await pool.query<RowDataPacket[]>(CFG_SQL, [...CYCLE_LOAD_ORDER]);
  const byCode = new Map(rows.map((r) => [String(r.report_code), toConfig(r)]));
  const missing = CYCLE_LOAD_ORDER.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Cycle pipeline is missing registry rows: ${missing.join(', ')}`);
  }
  return CYCLE_LOAD_ORDER.map((c) => byCode.get(c)!);
}

async function reschedule(id: number, status: 'SUCCESS' | 'FAILED'): Promise<void> {
  await pool.execute(
    `UPDATE ie_source_report
        SET last_run_at = NOW(),
            next_run_at = DATE_ADD(NOW(), INTERVAL frequency_minutes MINUTE),
            last_status = ?
      WHERE id = ?`,
    [status, id],
  );
}

async function holdDispatcher(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.execute(
    `UPDATE ie_source_report
        SET next_run_at = DATE_ADD(NOW(), INTERVAL frequency_minutes MINUTE)
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
}

/**
 * Same lock table the workers use, so two "Run now" clicks cannot interleave
 * the five steps. Expires in an hour, matching BaseInsightsWorker.
 */
async function acquireLock(): Promise<boolean> {
  const lockedBy = `${os.hostname()}-${process.pid}`;
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.execute<RowDataPacket[]>(
      'SELECT expires_at FROM ie_ingestion_lock WHERE worker_name = ?',
      [CYCLE_LOCK_NAME],
    );
    if (existing.length > 0 && new Date(existing[0].expires_at) > new Date()) return false;
    if (existing.length > 0) {
      await conn.execute('DELETE FROM ie_ingestion_lock WHERE worker_name = ?', [CYCLE_LOCK_NAME]);
    }
    await conn.execute(
      `INSERT INTO ie_ingestion_lock (worker_name, locked_at, locked_by, expires_at)
       VALUES (?, NOW(), ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [CYCLE_LOCK_NAME, lockedBy],
    );
    return true;
  } finally {
    conn.release();
  }
}

async function releaseLock(): Promise<void> {
  await pool.execute('DELETE FROM ie_ingestion_lock WHERE worker_name = ?', [CYCLE_LOCK_NAME]);
}

export async function runCyclePipeline(): Promise<CyclePipelineResult> {
  if (!(await acquireLock())) {
    logger.info('Cycle pipeline skipped (lock held)', { service: SERVICE });
    return { status: 'BUSY', steps: [] };
  }

  const steps: CyclePipelineStep[] = [];
  try {
    const configs = await loadConfigs();
    await holdDispatcher(configs.map((c) => c.id));

    for (const cfg of configs) {
      try {
        const result = await new SourceReportSyncWorker(cfg).run();
        if (result === null) {
          throw new Error(`${cfg.report_code} is already running`);
        }
        await reschedule(cfg.id, 'SUCCESS');
        steps.push({ code: cfg.report_code, status: 'SUCCESS' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await reschedule(cfg.id, 'FAILED').catch(() => {});
        steps.push({ code: cfg.report_code, status: 'FAILED', error: message });
        for (const later of configs.slice(steps.length)) {
          steps.push({ code: later.report_code, status: 'SKIPPED' });
        }
        logger.error('Cycle pipeline stopped', {
          service: SERVICE, failed: cfg.report_code, error: message,
        });
        await notifyIngestionFailure({
          channel: 'sql',
          name: 'Cycle Performance',
          code: cfg.report_code,
          reason: message,
        });
        return { status: 'FAILED', steps };
      }
    }

    logger.info('Cycle pipeline complete', { service: SERVICE, steps: steps.map((s) => s.code) });
    return { status: 'SUCCESS', steps };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Cycle pipeline failed before any load', { service: SERVICE, error: message });
    await notifyIngestionFailure({
      channel: 'sql',
      name: 'Cycle Performance',
      code: 'cycle-pipeline',
      reason: message,
    });
    return { status: 'FAILED', steps };
  } finally {
    await releaseLock();
  }
}
