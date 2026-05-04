/**
 * ConfidenceCalibrator
 *
 * Maps the model's nominal `overall_confidence` (0..1) to a calibrated
 * value using the per-form active `ai_calibration_map`. Identity when
 * no active map exists (Day 1 / sparse-data forms). The calibrated
 * value is what the inbox-routing materializer uses when comparing
 * against `ai_sample_low_confidence_threshold` — so a poorly-
 * calibrated model doesn't mis-route submissions.
 *
 * Why isotonic regression bins?
 *   Most LLM confidence outputs are over-confident in the 0.7-0.9
 *   range and under-confident at the extremes. Isotonic regression
 *   produces a monotonic step-function mapping (preserving the
 *   ordering of "more confident → higher score") without assuming a
 *   parametric form like a sigmoid. The bins JSON is just a sorted
 *   array of [low, high, calibrated] triples, easy to inspect by a
 *   human and trivial to apply at runtime.
 *
 * Active-map cache:
 *   Loaded once at boot (logCalibratorStateOnBoot) and on demand,
 *   then cached in memory for 5 minutes per form. The fitter
 *   invalidates the cache when it activates a new map.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';

/** Single bin in the calibration map: nominal in [low, high] → calibrated. */
export interface CalibrationBin {
  low: number;
  high: number;
  calibrated: number;
  /** Optional: how many samples informed this bin. */
  sample_count?: number;
}

export interface CalibrationMapBins {
  bins: CalibrationBin[];
  /** Default value used when nominal falls outside any bin (rare). */
  fallback?: number;
}

interface CachedActiveMap {
  formId: number;
  version: number;
  bins: CalibrationBin[];
  fallback: number;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CachedActiveMap>();

/**
 * Apply the form's active calibration map to a nominal confidence.
 * Returns identity (nominal === calibrated) when no active map exists.
 */
export async function applyCalibration(formId: number, nominal: number | null): Promise<number | null> {
  if (nominal == null || !Number.isFinite(nominal)) return null;
  const map = await getActiveMapForForm(formId);
  if (!map) return clamp01(nominal);
  for (const bin of map.bins) {
    if (nominal >= bin.low && nominal <= bin.high) return clamp01(bin.calibrated);
  }
  return clamp01(map.fallback);
}

export async function getActiveMapForForm(formId: number): Promise<CachedActiveMap | null> {
  const cached = cache.get(formId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  const row = await prisma.aiCalibrationMap.findFirst({
    where: { form_id: formId, is_active: true },
    orderBy: { version: 'desc' },
  });
  if (!row) {
    cache.delete(formId);
    return null;
  }
  const json = row.bins_json as unknown as CalibrationMapBins;
  const bins = Array.isArray(json?.bins) ? json.bins.filter(isValidBin) : [];
  if (bins.length === 0) {
    cache.delete(formId);
    return null;
  }
  const fallback = typeof json.fallback === 'number' ? json.fallback : binsAverage(bins);
  const entry: CachedActiveMap = {
    formId,
    version: row.version,
    bins,
    fallback,
    fetchedAt: Date.now(),
  };
  cache.set(formId, entry);
  return entry;
}

/**
 * Force the cache to refresh for a specific form. Called by the fitter
 * after activating a new map version so the next analyze() picks up
 * the change without waiting for the 5-minute TTL.
 */
export function invalidateActiveMapCache(formId?: number): void {
  if (formId == null) {
    cache.clear();
  } else {
    cache.delete(formId);
  }
}

/**
 * Smoke-signal #3: log on boot how many forms have an active
 * calibration map. Tells you at a glance whether confidence routing
 * is using calibrated or nominal values for the typical form.
 */
export async function logCalibratorStateOnBoot(): Promise<void> {
  try {
    const rows = await prisma.aiCalibrationMap.findMany({
      where: { is_active: true },
      select: { form_id: true, version: true, sample_count: true },
    });
    const formCount = new Set(rows.map((r) => r.form_id)).size;
    logger.info(
      `[AI REVIEWER] calibrator: ${formCount} form(s) have an active calibration map (${rows.length} active row(s) total)`
    );
    for (const r of rows) {
      logger.info(`[AI REVIEWER] calibrator: form_id=${r.form_id} version=${r.version} samples=${r.sample_count}`);
    }
  } catch (err) {
    logger.error('[AI REVIEWER] calibrator boot log failed', { error: (err as Error).message });
  }
}

function isValidBin(b: any): b is CalibrationBin {
  return (
    b &&
    typeof b.low === 'number' &&
    typeof b.high === 'number' &&
    typeof b.calibrated === 'number' &&
    b.low >= 0 &&
    b.high <= 1 &&
    b.low <= b.high
  );
}

function binsAverage(bins: CalibrationBin[]): number {
  const sum = bins.reduce((a, b) => a + b.calibrated, 0);
  return sum / Math.max(1, bins.length);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return Math.round(x * 100) / 100;
}
