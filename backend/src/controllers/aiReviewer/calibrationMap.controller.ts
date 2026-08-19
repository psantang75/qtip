import { Request, Response } from 'express';
import {
  fitAndStore as fitCalibrationMap,
  activateMap as activateCalibrationMap,
  getCalibrationCoverage,
  previewFit as previewCalibrationFit,
} from '../../services/ConfidenceCalibratorFitter';
import { getActiveMapForForm } from '../../services/ConfidenceCalibrator';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Confidence calibration-map controller (Phase 4).
 *
 * Reads a form's calibration coverage + active/historical maps, previews a
 * fresh fit, fits-and-stores a new map version, and activates a chosen
 * version — backed by `ConfidenceCalibratorFitter` / `ConfidenceCalibrator`.
 * Extracted verbatim from `ai-reviewer.routes.ts` (routes-thinning slice
 * after base-prompts / rule-packs / golden-set / eval-run); behavior, status
 * codes, and response shapes are unchanged. These handlers have no dedicated
 * error class — reads return 500, writes return 400 with the raw message — so
 * there is no shared `handle*Error` helper here.
 */

export const getCalibrationMap = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const [coverage, active, all] = await Promise.all([
      getCalibrationCoverage(formId),
      getActiveMapForForm(formId),
      prisma.aiCalibrationMap.findMany({
        where: { form_id: formId },
        orderBy: { version: 'desc' },
        take: 10,
      }),
    ]);
    return res.json({
      coverage,
      active: active
        ? { version: active.version, bins: active.bins, fallback: active.fallback }
        : null,
      versions: all.map((m) => ({
        id: m.id,
        version: m.version,
        fitted_at: m.fitted_at,
        sample_count: m.sample_count,
        is_active: m.is_active,
        notes: m.notes,
        bins: (m.bins_json as any)?.bins ?? [],
      })),
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map fetch failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load calibration map' });
  }
};

export const previewCalibrationMapFit = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const preview = await previewCalibrationFit(formId);
    return res.json(preview);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map preview failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to preview calibration fit' });
  }
};

export const fitCalibrationMapHandler = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const result = await fitCalibrationMap({ formId });
    return res.json(result);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map fit failed', { error: (err as Error).message, formId });
    return res.status(400).json({ error: (err as Error).message });
  }
};

export const activateCalibrationMapHandler = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  const mapId = parsePositiveInt(req.params.mapId);
  if (formId === null || mapId === null) {
    return res.status(400).json({ error: 'formId and mapId must be positive integers' });
  }
  try {
    const result = await activateCalibrationMap({ formId, mapId });
    return res.json(result);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map activate failed', { error: (err as Error).message, formId, mapId });
    return res.status(400).json({ error: (err as Error).message });
  }
};
