import { Request, Response } from 'express';
import prisma from '../config/prisma';
import {
  asyncHandler,
  createValidationError,
  createNotFoundError,
} from '../utils/errorHandler';
import logger from '../config/logger';
import { SourceReportSyncWorker, SourceReportConfig } from '../workers/SourceReportSyncWorker';
import { notifyIngestionFailure } from '../services/notifications/ingestionAlerts';

/**
 * Insights Admin Source Report controller — manages the scheduling fields of
 * the `ie_source_report` registry that drives automated ingestion via the
 * `SourceReportDispatcher` (`/api/insights/admin/source-reports/*`).
 *
 * Only scheduling fields are editable here (`frequency_minutes`,
 * `run_only_hours`, `is_active`) plus a "run now" that reschedules `next_run_at`
 * so the dispatcher picks the report up on its next tick. Structural fields
 * (report_code, SQL files, load_mode, window sizing, tables) and worker-owned
 * runtime state (last_run_at, last_status) are never written from the API —
 * cadence is intentionally data-driven and tunable without a redeploy.
 *
 * Data access: Prisma only (via the `IeSourceReport` model), mirroring
 * `insightsAdminKpi.controller.ts` / `insightsAdminPage.controller.ts`. Errors
 * use the canonical `AppError` envelope rendered by the global handler. The
 * SourceReportDispatcher / SourceReportSyncWorker still run their own raw SQL
 * against the same table — Prisma and those workers read/write the identical
 * rows, so this stays consistent with the ingestion-log process.
 */

const RUN_ONLY_HOURS_RE = /^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/;

type SourceReportRow = NonNullable<Awaited<ReturnType<typeof prisma.ieSourceReport.findFirst>>>;

/** Public row shape for the admin UI — deliberately omits structural fields
 *  (SQL files, staging table) and normalizes dates/booleans. */
function mapRow(r: SourceReportRow) {
  return {
    id: r.id,
    report_code: r.report_code,
    report_name: r.report_name,
    source_pool: r.source_pool as string,
    load_mode: r.load_mode as string,
    window_months: r.window_months,
    incremental_days: r.incremental_days,
    frequency_minutes: r.frequency_minutes,
    run_only_hours: r.run_only_hours ?? null,
    is_active: r.is_active,
    target_fact_table: r.target_fact_table,
    last_run_at: r.last_run_at ? r.last_run_at.toISOString() : null,
    next_run_at: r.next_run_at ? r.next_run_at.toISOString() : null,
    last_status: (r.last_status as string | null) ?? null,
  };
}

/** Map a registry row to the SourceReportSyncWorker config shape. */
function toConfig(r: SourceReportRow): SourceReportConfig {
  return {
    id: r.id,
    report_code: r.report_code,
    report_name: r.report_name,
    source_pool: r.source_pool as SourceReportConfig['source_pool'],
    extract_sql_file: r.extract_sql_file,
    transform_sql_file: r.transform_sql_file ?? null,
    staging_table: r.staging_table,
    target_fact_table: r.target_fact_table,
    load_mode: r.load_mode as SourceReportConfig['load_mode'],
    window_months: r.window_months,
    incremental_days: r.incremental_days,
  };
}

/** `NOW() + <minutes>` as a UTC instant (Prisma stores UTC, matching the pool's
 *  `timezone: 'Z'` pinning), equivalent to SQL DATE_ADD(NOW(), INTERVAL m MINUTE). */
function inMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw createValidationError('Invalid source report id');
  return id;
}

/** Stamp last_run_at/next_run_at/last_status after a manual run, like the
 *  dispatcher's reschedule. `updateMany` so a since-deleted row is a silent
 *  no-op (matches the old raw UPDATE affecting 0 rows). */
async function reschedule(id: number, status: 'SUCCESS' | 'FAILED'): Promise<void> {
  const row = await prisma.ieSourceReport.findUnique({
    where: { id },
    select: { frequency_minutes: true },
  });
  const freq = row?.frequency_minutes ?? 60;
  await prisma.ieSourceReport.updateMany({
    where: { id },
    data: { last_run_at: new Date(), next_run_at: inMinutes(freq), last_status: status },
  });
}

/**
 * GET /api/insights/admin/source-reports
 */
export const listSourceReportsAdmin = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const rows = await prisma.ieSourceReport.findMany({ orderBy: { report_name: 'asc' } });
  res.json(rows.map(mapRow));
});

/**
 * PUT /api/insights/admin/source-reports/:id
 * Updates only the scheduling fields. Partial: send any subset.
 */
export const updateSourceReport = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);

  const data: { frequency_minutes?: number; run_only_hours?: string | null; is_active?: boolean } = {};

  if (req.body.frequency_minutes !== undefined) {
    const freq = Number(req.body.frequency_minutes);
    if (!Number.isInteger(freq) || freq < 5) {
      throw createValidationError('frequency_minutes must be an integer >= 5');
    }
    data.frequency_minutes = freq;
  }

  if (req.body.run_only_hours !== undefined) {
    const raw = req.body.run_only_hours;
    if (raw === null || raw === '') {
      data.run_only_hours = null;
    } else if (typeof raw === 'string' && RUN_ONLY_HOURS_RE.test(raw.trim())) {
      data.run_only_hours = raw.trim().replace(/\s/g, '');
    } else {
      throw createValidationError("run_only_hours must be blank or an hour range like '2-5' (0-23)");
    }
  }

  if (req.body.is_active !== undefined) {
    data.is_active = !!req.body.is_active;
  }

  if (Object.keys(data).length === 0) throw createValidationError('No editable fields supplied');

  try {
    const updated = await prisma.ieSourceReport.update({ where: { id }, data });
    res.json(mapRow(updated));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2025') {
      throw createNotFoundError('Source report not found');
    }
    throw error;
  }
});

/**
 * POST /api/insights/admin/source-reports/:id/run-now
 * Runs the ingestion immediately, in-process, using the same worker the
 * dispatcher uses (which handles its own per-report lock + run logging). The
 * run is fired asynchronously and we return 202 right away, because a full
 * reload can take a while; the report's `last_status` / `last_run_at` update
 * when it finishes (watch the Ingestion Log, or Refresh this page).
 */
export const runSourceReportNow = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);

  const row = await prisma.ieSourceReport.findUnique({ where: { id } });
  if (!row) throw createNotFoundError('Source report not found');
  const cfg = toConfig(row);

  // Push next_run_at out now so the periodic dispatcher won't also fire this
  // report while the manual run is in flight (the worker lock would make that
  // a no-op anyway, but this keeps the schedule honest).
  await prisma.ieSourceReport.update({
    where: { id },
    data: { next_run_at: inMinutes(row.frequency_minutes) },
  });

  res.status(202).json({ started: true });

  // Run in the background — the HTTP response has already been sent.
  void (async () => {
    try {
      const result = await new SourceReportSyncWorker(cfg).run();
      // null == another run held the lock; leave its status alone.
      if (result !== null) await reschedule(id, 'SUCCESS');
    } catch (err) {
      logger.error('runSourceReportNow background run failed', { report: cfg.report_code, error: (err as Error)?.message });
      await reschedule(id, 'FAILED').catch(() => {});
      await notifyIngestionFailure({
        channel: 'sql',
        name: cfg.report_name,
        code: cfg.report_code,
        reason: (err as Error)?.message ?? 'Report run failed',
      });
    }
  })();
});
