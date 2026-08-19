import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import {
  asyncHandler,
  createValidationError,
  createNotFoundError,
  AppError,
  ErrorType,
} from '../utils/errorHandler';

/**
 * Insights Admin KPI controller — CRUD over the `ie_kpi` +
 * `ie_kpi_threshold` tables that drive the Insights dashboards
 * (`/api/insights/admin/kpis/*`).
 *
 * Data access: Prisma only (pre-production review items on data-access
 * standardization). This controller was migrated off the legacy `mysql2`
 * pool as the pilot for the "one data-access layer" cleanup; response shapes
 * are preserved exactly (`threshold_count`, `YYYY-MM-DD` threshold dates,
 * joined `department_name`). Errors use the canonical `AppError` envelope
 * rendered by the global handler (see `utils/errorHandler.ts`).
 *
 * Domain boundary (do not merge with `metricController.ts` — pre-production
 * review item #73):
 *
 *   - This controller owns the **insights-platform** KPI registry: SQL
 *     formulas resolved by `services/QCKpiService.ts`, materialized by
 *     the rollup workers, and consumed by Overview / Quality / Coaching
 *     / Warnings dashboards. KPIs carry `formula`, `formula_type`,
 *     `format_type`, `unit_label`, and `category` columns that the
 *     legacy `metrics` table does not have.
 *
 *   - `metricController.ts` (`/api/metrics/*`, `services/metricService.ts`)
 *     owns the **manager-facing** Performance Metrics registry backing
 *     Performance Goals + Performance Reviews. Aggregation is
 *     `AVG`/`SUM`/`COUNT`, no formula text.
 *
 * The two registries stay separate because their consumers, caching
 * layers, and lifecycle (platform-curated KPIs vs. manager-edited
 * metrics) are different. New work goes into whichever registry already
 * owns the surface the change applies to; do not bridge them.
 */

const VALID_DIRECTIONS = ['UP_IS_GOOD', 'DOWN_IS_GOOD', 'NEUTRAL'] as const;
const VALID_FORMAT_TYPES = ['PERCENT', 'NUMBER'] as const;

const createKpiSchema = z.object({
  kpi_code: z.string().min(1),
  kpi_name: z.string().min(1),
  description: z.string().nullish(),
  category: z.string().min(1),
  formula_type: z.string().default('SQL'),
  formula: z.string().min(1),
  source_table: z.string().nullish(),
  format_type: z.enum(VALID_FORMAT_TYPES),
  decimal_places: z.number().int().min(0).default(1),
  direction: z.enum(VALID_DIRECTIONS),
  unit_label: z.string().nullish(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const updateKpiSchema = createKpiSchema.partial();

const setThresholdSchema = z.object({
  department_key: z.number().int().nullish(),
  goal_value: z.number().nullish(),
  warning_value: z.number().nullish(),
  critical_value: z.number().nullish(),
  effective_from: z.string().min(1, 'effective_from is required'),
  effective_to: z.string().nullish(),
});

const updateThresholdSchema = setThresholdSchema.omit({ department_key: true });

/** A `@db.Date` column is read by Prisma as UTC midnight; slicing the ISO
 *  string yields the stored calendar date without a timezone shift (the one
 *  place UTC extraction is correct — see .cursor/rules/date-handling.mdc). */
function fmtDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function parseId(raw: string, label: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw createValidationError(`Invalid ${label}`);
  return id;
}

/**
 * GET /api/insights/admin/kpis
 */
export const listKpis = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const rows = await prisma.ieKpi.findMany({
    orderBy: [{ category: 'asc' }, { sort_order: 'asc' }],
    include: { _count: { select: { thresholds: true } } },
  });
  res.json(rows.map(({ _count, ...k }) => ({ ...k, threshold_count: _count.thresholds })));
});

/**
 * POST /api/insights/admin/kpis
 */
export const createKpi = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const d = createKpiSchema.parse(req.body);
  try {
    const created = await prisma.ieKpi.create({
      data: {
        kpi_code: d.kpi_code,
        kpi_name: d.kpi_name,
        description: d.description ?? null,
        category: d.category,
        formula_type: d.formula_type,
        formula: d.formula,
        source_table: d.source_table ?? null,
        format_type: d.format_type,
        decimal_places: d.decimal_places,
        direction: d.direction,
        unit_label: d.unit_label ?? null,
        is_active: d.is_active,
        sort_order: d.sort_order,
        created_by: req.user?.user_id ?? null,
      },
    });
    res.status(201).json(created);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2002') {
      throw new AppError('A KPI with this code already exists', ErrorType.VALIDATION_ERROR, 409);
    }
    throw error;
  }
});

/**
 * PUT /api/insights/admin/kpis/:id
 */
export const updateKpi = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id, 'KPI id');
  const data = updateKpiSchema.parse(req.body);
  if (Object.keys(data).length === 0) throw createValidationError('No fields to update');

  try {
    const updated = await prisma.ieKpi.update({ where: { id }, data });
    res.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2025') {
      throw createNotFoundError('KPI not found');
    }
    throw error;
  }
});

/**
 * GET /api/insights/admin/kpis/:id/thresholds
 */
export const getThresholds = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const kpiId = parseId(req.params.id, 'KPI id');
  const rows = await prisma.ieKpiThreshold.findMany({
    where: { kpi_id: kpiId },
    orderBy: { effective_from: 'desc' },
    include: { department: { select: { department_name: true, is_current: true } } },
  });
  res.json(
    rows.map((t) => ({
      id: t.id,
      kpi_id: t.kpi_id,
      department_key: t.department_key,
      goal_value: t.goal_value,
      warning_value: t.warning_value,
      critical_value: t.critical_value,
      effective_from: fmtDate(t.effective_from),
      effective_to: fmtDate(t.effective_to),
      created_at: t.created_at,
      updated_at: t.updated_at,
      // Match the legacy LEFT JOIN ... AND d.is_current = 1 semantics.
      department_name: t.department?.is_current ? t.department.department_name : null,
    })),
  );
});

/**
 * POST /api/insights/admin/kpis/:id/thresholds
 */
export const setThreshold = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const kpiId = parseId(req.params.id, 'KPI id');
  const d = setThresholdSchema.parse(req.body);
  const deptKey = d.department_key ?? null;
  const effectiveFrom = new Date(d.effective_from);
  const effectiveTo = d.effective_to ? new Date(d.effective_to) : null;

  // Replicates INSERT ... ON DUPLICATE KEY UPDATE on the
  // (kpi_id, department_key, effective_from) unique key.
  const existing = await prisma.ieKpiThreshold.findFirst({
    where: { kpi_id: kpiId, department_key: deptKey, effective_from: effectiveFrom },
  });

  const saved = existing
    ? await prisma.ieKpiThreshold.update({
        where: { id: existing.id },
        data: {
          goal_value: d.goal_value ?? null,
          warning_value: d.warning_value ?? null,
          critical_value: d.critical_value ?? null,
          effective_to: effectiveTo,
        },
      })
    : await prisma.ieKpiThreshold.create({
        data: {
          kpi_id: kpiId,
          department_key: deptKey,
          goal_value: d.goal_value ?? null,
          warning_value: d.warning_value ?? null,
          critical_value: d.critical_value ?? null,
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
        },
      });

  res.status(201).json({ ...saved, effective_from: fmtDate(saved.effective_from), effective_to: fmtDate(saved.effective_to) });
});

/**
 * PUT /api/insights/admin/kpis/:id/thresholds/:thresholdId
 */
export const updateThreshold = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const kpiId = parseId(req.params.id, 'KPI id');
  const thresholdId = parseId(req.params.thresholdId, 'threshold id');
  const d = updateThresholdSchema.parse(req.body);

  const existing = await prisma.ieKpiThreshold.findFirst({ where: { id: thresholdId, kpi_id: kpiId } });
  if (!existing) throw createNotFoundError('Threshold not found');

  const updated = await prisma.ieKpiThreshold.update({
    where: { id: thresholdId },
    data: {
      goal_value: d.goal_value ?? null,
      warning_value: d.warning_value ?? null,
      critical_value: d.critical_value ?? null,
      effective_from: new Date(d.effective_from),
      effective_to: d.effective_to ? new Date(d.effective_to) : null,
    },
  });

  res.json({ ...updated, effective_from: fmtDate(updated.effective_from), effective_to: fmtDate(updated.effective_to) });
});

/**
 * DELETE /api/insights/admin/kpis/:id/thresholds/:thresholdId
 */
export const deleteThreshold = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const kpiId = parseId(req.params.id, 'KPI id');
  const thresholdId = parseId(req.params.thresholdId, 'threshold id');

  const result = await prisma.ieKpiThreshold.deleteMany({ where: { id: thresholdId, kpi_id: kpiId } });
  if (result.count === 0) throw createNotFoundError('Threshold not found');
  res.json({ success: true });
});
