import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { asyncHandler, createValidationError, createNotFoundError } from '../utils/errorHandler';
import logger from '../config/logger';
import { runMonitorEvaluation } from '../services/insights/datasetMonitor';

/**
 * Insights Admin Monitoring controller — the dataset health dashboard + registry
 * editor (`/api/insights/admin/monitoring/*`).
 *
 * - GET  /health          → latest OK/WARN/RED per dataset (ie_dataset_health left
 *                           joined onto the active ie_dataset_monitor registry).
 * - GET  /datasets        → the editable ie_dataset_monitor rows (thresholds/schedule).
 * - PUT  /datasets/:id     → update thresholds/schedule only (never structural
 *                           fields: dataset_code, producer_ref, fact_table, …).
 * - POST /run             → trigger an immediate evaluation (async, returns 202).
 *
 * Data access is Prisma via the IeDatasetMonitor / IeDatasetHealth models,
 * mirroring insightsAdminSourceReport.controller.ts. The MonitoringWorker writes
 * the identical ie_dataset_health rows with raw SQL — Prisma and the worker
 * read/write the same table, consistent with the source-report pattern.
 */

type MonitorRow = NonNullable<Awaited<ReturnType<typeof prisma.ieDatasetMonitor.findFirst>>>;

function mapMonitor(r: MonitorRow) {
  return {
    id: r.id,
    dataset_code: r.dataset_code,
    display_name: r.display_name,
    producer_kind: r.producer_kind,
    producer_ref: r.producer_ref,
    check_kind: r.check_kind,
    fact_table: r.fact_table ?? null,
    expected_by_hour: r.expected_by_hour,
    cadence_minutes: r.cadence_minutes,
    arrears_days: r.arrears_days,
    business_days_only: r.business_days_only,
    baseline_lookback_days: r.baseline_lookback_days,
    warn_pct: Number(r.warn_pct),
    red_pct: Number(r.red_pct),
    min_expected_rows: r.min_expected_rows,
    zero_is_red: r.zero_is_red,
    is_active: r.is_active,
  };
}

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw createValidationError('Invalid dataset monitor id');
  return id;
}

/** GET /api/insights/admin/monitoring/health */
export const getMonitoringHealth = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const [monitors, health] = await Promise.all([
    prisma.ieDatasetMonitor.findMany({ where: { is_active: true }, orderBy: { display_name: 'asc' } }),
    prisma.ieDatasetHealth.findMany(),
  ]);
  const byCode = new Map(health.map((h) => [h.dataset_code, h]));

  const rows = monitors.map((m) => {
    const h = byCode.get(m.dataset_code);
    return {
      datasetCode: m.dataset_code,
      displayName: m.display_name,
      producerKind: m.producer_kind,
      checkKind: m.check_kind,
      status: h?.status ?? 'UNKNOWN',
      reason: h?.reason ?? 'not evaluated yet',
      lastSuccessAt: h?.last_success_at ? h.last_success_at.toISOString() : null,
      expectedBy: h?.expected_by ? h.expected_by.toISOString() : null,
      lastRowCount: h?.last_row_count ?? null,
      baselineCount: h?.baseline_count ?? null,
      statusSince: h?.status_since ? h.status_since.toISOString() : null,
      evaluatedAt: h?.evaluated_at ? h.evaluated_at.toISOString() : null,
    };
  });
  res.json(rows);
});

/** GET /api/insights/admin/monitoring/datasets */
export const listDatasetMonitors = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const rows = await prisma.ieDatasetMonitor.findMany({ orderBy: { display_name: 'asc' } });
  res.json(rows.map(mapMonitor));
});

const updateSchema = z.object({
  expected_by_hour: z.number().int().min(0).max(23),
  cadence_minutes: z.number().int().min(5),
  arrears_days: z.number().int().min(0).max(7),
  business_days_only: z.boolean(),
  baseline_lookback_days: z.number().int().min(7).max(365),
  warn_pct: z.number().min(0).max(100),
  red_pct: z.number().min(0).max(100),
  min_expected_rows: z.number().int().min(0),
  zero_is_red: z.boolean(),
  is_active: z.boolean(),
}).partial().strict();

/** PUT /api/insights/admin/monitoring/datasets/:id — thresholds/schedule only. */
export const updateDatasetMonitor = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw createValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) throw createValidationError('No editable fields supplied');
  if (data.red_pct !== undefined && data.warn_pct !== undefined && data.red_pct > data.warn_pct) {
    throw createValidationError('red_pct must be <= warn_pct');
  }

  try {
    const updated = await prisma.ieDatasetMonitor.update({ where: { id }, data });
    res.json(mapMonitor(updated));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2025') {
      throw createNotFoundError('Dataset monitor not found');
    }
    throw error;
  }
});

/** POST /api/insights/admin/monitoring/run — evaluate all datasets now (async). */
export const runMonitoringNow = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  res.status(202).json({ started: true });
  void (async () => {
    try {
      await runMonitorEvaluation();
    } catch (err) {
      logger.error('runMonitoringNow background evaluation failed', { error: (err as Error)?.message });
    }
  })();
});
