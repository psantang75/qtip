import { Request, Response } from 'express';
import {
  getAllMetrics,
  getMetricById,
  createMetric,
  updateMetric,
  setThreshold,
  getThresholds,
} from '../services/metricService';
import logger from '../config/logger';

/**
 * Metric controller — CRUD over the legacy `metrics` + `metric_thresholds`
 * tables that back the Performance Metrics admin UI (`/api/metrics/*`).
 *
 * Domain boundary (do not merge with the KPI controller — pre-production
 * review item #73):
 *
 *   - `/api/metrics/*` (this controller, `services/metricService.ts`,
 *     tables `metrics` + `metric_thresholds`) is the **manager-facing**
 *     metric registry. It models the Performance Goals + Performance
 *     Reviews surfaces. Aggregation is `AVG`/`SUM`/`COUNT` against
 *     submission/coaching rows. Direction set is the legacy
 *     `UP_IS_GOOD | DOWN_IS_GOOD | NEUTRAL`.
 *
 *   - `/api/insights/admin/kpis/*`
 *     (`insightsAdminKpi.controller.ts`, tables `ie_kpi` +
 *     `ie_kpi_threshold`) is the **insights-platform** KPI registry. It
 *     drives the Insights dashboards (Overview / Quality / Coaching /
 *     Warnings) through `QCKpiService` + the rollup workers. KPIs carry
 *     a `formula` (raw SQL) + a `formula_type`, `format_type`, and
 *     `unit_label`, none of which exist on `metrics`.
 *
 * The two registries are intentionally separate because their consumers,
 * caching layers, and lifecycle (manager edits vs. platform-curated
 * KPIs) are different. New work goes into whichever registry already
 * owns the surface the change applies to; do not bridge them.
 */

export const getAllMetricsHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await getAllMetrics();
    res.status(200).json({ data: metrics });
  } catch (error: any) {
    logger.error('[METRIC CONTROLLER] getAllMetrics error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch metrics' });
  }
};

export const getMetricByIdHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ message: 'Invalid metric ID' }); return; }

    const metric = await getMetricById(id);
    if (!metric) { res.status(404).json({ message: 'Metric not found' }); return; }

    res.status(200).json({ data: metric });
  } catch (error: any) {
    logger.error('[METRIC CONTROLLER] getMetricById error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch metric' });
  }
};

export const createMetricHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, name, aggregation, direction, is_cumulative, is_active } = req.body;
    if (!code || !name || !aggregation || !direction) {
      res.status(400).json({ message: 'code, name, aggregation, and direction are required' });
      return;
    }
    const metric = await createMetric({ code, name, aggregation, direction, is_cumulative, is_active });
    res.status(201).json({ data: metric });
  } catch (error: any) {
    logger.error('[METRIC CONTROLLER] createMetric error:', error);
    if (error?.code === 'P2002') {
      res.status(409).json({ message: 'A metric with that code already exists' });
      return;
    }
    res.status(500).json({ message: error?.message || 'Failed to create metric' });
  }
};

export const updateMetricHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ message: 'Invalid metric ID' }); return; }

    const metric = await updateMetric(id, req.body);
    res.status(200).json({ data: metric });
  } catch (error: any) {
    logger.error('[METRIC CONTROLLER] updateMetric error:', error);
    if (error?.code === 'P2025') {
      res.status(404).json({ message: 'Metric not found' });
      return;
    }
    res.status(500).json({ message: error?.message || 'Failed to update metric' });
  }
};

export const setThresholdHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const metricId = parseInt(req.params.id, 10);
    if (isNaN(metricId)) { res.status(400).json({ message: 'Invalid metric ID' }); return; }

    const { red_below, yellow_below, department_id } = req.body;
    if (red_below === undefined || yellow_below === undefined) {
      res.status(400).json({ message: 'red_below and yellow_below are required' });
      return;
    }

    const threshold = await setThreshold(metricId, { red_below, yellow_below, department_id });
    res.status(200).json({ data: threshold });
  } catch (error: any) {
    logger.error('[METRIC CONTROLLER] setThreshold error:', error);
    res.status(500).json({ message: error?.message || 'Failed to set threshold' });
  }
};

export const getThresholdsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const metricId = parseInt(req.params.id, 10);
    if (isNaN(metricId)) { res.status(400).json({ message: 'Invalid metric ID' }); return; }

    const departmentId = req.query.department_id
      ? parseInt(req.query.department_id as string, 10)
      : undefined;

    const thresholds = await getThresholds(metricId, departmentId);
    res.status(200).json({ data: thresholds });
  } catch (error: any) {
    logger.error('[METRIC CONTROLLER] getThresholds error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch thresholds' });
  }
};
