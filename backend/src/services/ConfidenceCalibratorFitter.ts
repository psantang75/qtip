/**
 * ConfidenceCalibratorFitter
 *
 * Fits per-form isotonic-regression bins for the confidence
 * calibration map. The fitter looks at every reviewed AI submission
 * for a form (last 12 months by default), buckets them by nominal
 * `ai_overall_confidence` at 0.05 width, computes the empirical
 * agreement rate per bucket (full-match against the human's grade in
 * the matching ai_calibration_data row), then runs the pool-adjacent-
 * violators algorithm to enforce monotonicity (higher nominal
 * confidence MUST map to a calibrated value ≥ neighbors below it).
 *
 * Outputs a new ai_calibration_map row with `is_active = false`.
 * An admin previews + flips the row active via the
 * "Activate calibration map" button in the UI; the calibrator picks
 * up the change on the next request after the cache TTL (5 min) or
 * sooner via invalidateActiveMapCache().
 *
 * Why isotonic instead of Platt scaling / sigmoid?
 *   - No parametric assumption about the calibration shape.
 *   - Monotonicity is exactly the property we need (preserves the
 *     ordering of "more confident → higher score").
 *   - Bin output is human-readable and auditable.
 *
 * Sample-count gate:
 *   The default minimum sample count is 200. Below that the
 *   isotonic fit is too noisy to trust, and we'd be over-fitting
 *   the calibration to small bucket counts. The "Fit map" UI
 *   button surfaces the current count vs. the gate so admins know
 *   when to retry.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';
import { invalidateActiveMapCache, type CalibrationBin } from './ConfidenceCalibrator';

const DEFAULT_MIN_SAMPLES = 200;
const DEFAULT_LOOKBACK_DAYS = 365;
const BIN_WIDTH = 0.05;

export interface FitResult {
  /** Inserted (still inactive) ai_calibration_map row id. */
  id: number;
  form_id: number;
  version: number;
  sample_count: number;
  bins: CalibrationBin[];
  /** Coverage diagnostic: how many of the 20 default bins have >=5 samples. */
  bins_with_data: number;
}

export interface CalibrationCoverage {
  form_id: number;
  sample_count: number;
  min_samples: number;
  ready_to_fit: boolean;
  active_map_version: number | null;
  active_map_fitted_at: Date | null;
}

/** Result of the next-version preview ("what would the fit produce now?"). */
export interface PreviewResult {
  bins: CalibrationBin[];
  sample_count: number;
  bins_with_data: number;
}

/**
 * Returns whether the form has enough data to fit a calibration map.
 * Drives the sample-count gate on the "Fit map" UI button.
 */
export async function getCalibrationCoverage(formId: number): Promise<CalibrationCoverage> {
  const sampleCount = await countEligibleRows(formId);
  const active = await prisma.aiCalibrationMap.findFirst({
    where: { form_id: formId, is_active: true },
    orderBy: { version: 'desc' },
  });
  return {
    form_id: formId,
    sample_count: sampleCount,
    min_samples: DEFAULT_MIN_SAMPLES,
    ready_to_fit: sampleCount >= DEFAULT_MIN_SAMPLES,
    active_map_version: active?.version ?? null,
    active_map_fitted_at: active?.fitted_at ?? null,
  };
}

/**
 * Build (nominal_confidence, empirical_agreement) pairs without
 * persisting anything. Returns the bins the fitter WOULD produce so
 * an admin can sanity-check before activating.
 */
export async function previewFit(formId: number): Promise<PreviewResult> {
  const samples = await loadEligibleSamples(formId);
  if (samples.length === 0) return { bins: [], sample_count: 0, bins_with_data: 0 };
  const buckets = bucketize(samples);
  const monotone = poolAdjacentViolators(buckets);
  const bins = bucketsToBins(monotone);
  const binsWithData = monotone.filter((b) => b.n >= 5).length;
  return { bins, sample_count: samples.length, bins_with_data: binsWithData };
}

/**
 * Run the fit, then insert a new (inactive) ai_calibration_map row.
 */
export async function fitAndStore(opts: { formId: number; minSamples?: number }): Promise<FitResult> {
  const formId = opts.formId;
  const minSamples = opts.minSamples ?? DEFAULT_MIN_SAMPLES;
  const samples = await loadEligibleSamples(formId);
  if (samples.length < minSamples) {
    throw new Error(
      `Not enough reviewed submissions to fit (need ${minSamples}, have ${samples.length}).`
    );
  }
  const buckets = bucketize(samples);
  const monotone = poolAdjacentViolators(buckets);
  const bins = bucketsToBins(monotone);
  const nextVersion = await computeNextVersion(formId);
  const created = await prisma.aiCalibrationMap.create({
    data: {
      form_id: formId,
      version: nextVersion,
      sample_count: samples.length,
      bins_json: { bins, fallback: 0.5 } as any,
      is_active: false,
      notes: `auto-fit (${samples.length} samples)`,
    },
  });
  const binsWithData = monotone.filter((b) => b.n >= 5).length;
  logger.info(
    `[AI CALIBRATOR] fit form_id=${formId} version=${nextVersion} samples=${samples.length} bins_with_data=${binsWithData}`
  );
  return {
    id: created.id,
    form_id: formId,
    version: nextVersion,
    sample_count: samples.length,
    bins,
    bins_with_data: binsWithData,
  };
}

/**
 * Activate a stored map. Deactivates all other versions for the form
 * (one active map per form). Invalidates the in-memory cache so the
 * next analyze() call picks up the change immediately.
 */
export async function activateMap(opts: { formId: number; mapId: number }): Promise<{ activated: number }> {
  const target = await prisma.aiCalibrationMap.findUnique({ where: { id: opts.mapId } });
  if (!target || target.form_id !== opts.formId) {
    throw new Error(`Calibration map ${opts.mapId} not found for form ${opts.formId}`);
  }
  await prisma.$transaction([
    prisma.aiCalibrationMap.updateMany({
      where: { form_id: opts.formId, is_active: true },
      data: { is_active: false },
    }),
    prisma.aiCalibrationMap.update({
      where: { id: opts.mapId },
      data: { is_active: true },
    }),
  ]);
  invalidateActiveMapCache(opts.formId);
  logger.info(`[AI CALIBRATOR] activated map id=${opts.mapId} form_id=${opts.formId} version=${target.version}`);
  return { activated: opts.mapId };
}

// ------ internals ----------------------------------------------------------

interface Sample {
  nominal: number; // 0..1
  agreed: 0 | 1;
}

interface Bucket {
  index: number; // 0..19
  agree: number;
  total: number;
}

interface Monotone {
  index: number;
  rate: number;
  n: number;
}

function bucketize(samples: Sample[]): Bucket[] {
  const buckets: Bucket[] = Array.from({ length: Math.ceil(1 / BIN_WIDTH) }, (_, i) => ({
    index: i,
    agree: 0,
    total: 0,
  }));
  for (const s of samples) {
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor(s.nominal / BIN_WIDTH)));
    buckets[idx].total += 1;
    buckets[idx].agree += s.agreed;
  }
  return buckets.filter((b) => b.total > 0);
}

/**
 * Pool-Adjacent-Violators algorithm (PAV) — minimal implementation
 * that enforces a monotonically non-decreasing rate across the bucket
 * sequence by merging adjacent buckets whose rates violate ordering.
 */
function poolAdjacentViolators(buckets: Bucket[]): Monotone[] {
  if (buckets.length === 0) return [];
  const out: Monotone[] = buckets.map((b) => ({ index: b.index, rate: b.agree / b.total, n: b.total }));
  let merged: Array<{ rate: number; n: number; agree: number; indices: number[] }> = out.map((b, i) => ({
    rate: b.rate,
    n: b.n,
    agree: buckets[i].agree,
    indices: [b.index],
  }));
  let i = 0;
  while (i + 1 < merged.length) {
    if (merged[i].rate > merged[i + 1].rate) {
      // Merge i and i+1; restart from previous to propagate violations.
      const a = merged[i];
      const b = merged[i + 1];
      const combinedAgree = a.agree + b.agree;
      const combinedN = a.n + b.n;
      const combined = {
        agree: combinedAgree,
        n: combinedN,
        rate: combinedAgree / combinedN,
        indices: [...a.indices, ...b.indices],
      };
      merged.splice(i, 2, combined);
      if (i > 0) i -= 1;
    } else {
      i += 1;
    }
  }
  // Expand merged groups back to one Monotone per original bucket index.
  const result: Monotone[] = [];
  for (const m of merged) {
    for (const idx of m.indices) {
      result.push({ index: idx, rate: m.rate, n: m.n / m.indices.length });
    }
  }
  return result;
}

function bucketsToBins(monotone: Monotone[]): CalibrationBin[] {
  return monotone.map((m) => ({
    low: round2(m.index * BIN_WIDTH),
    high: round2((m.index + 1) * BIN_WIDTH),
    calibrated: round2(m.rate),
    sample_count: Math.round(m.n),
  }));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

async function loadEligibleSamples(formId: number): Promise<Sample[]> {
  const cutoff = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // Pull every calibration row with both AI and human sides on this form,
  // joined to the AI submission so we can read its overall_confidence.
  const rows = await prisma.aiCalibrationData.findMany({
    where: {
      form_id: formId,
      created_at: { gte: cutoff },
      ai_submission_id: { not: null },
    },
    select: {
      ai_answers: true,
      human_answers: true,
      ai_submission_id: true,
    },
  });
  if (rows.length === 0) return [];
  const submissionIds = rows.map((r) => r.ai_submission_id!).filter((x) => x != null);
  const submissions = await prisma.submission.findMany({
    where: { id: { in: submissionIds } },
    select: { id: true, ai_overall_confidence: true },
  });
  const confById = new Map(
    submissions.map((s) => [s.id, s.ai_overall_confidence != null ? Number(s.ai_overall_confidence) : null])
  );
  const samples: Sample[] = [];
  for (const r of rows) {
    if (!r.ai_submission_id) continue;
    const conf = confById.get(r.ai_submission_id);
    if (conf == null || !Number.isFinite(conf)) continue;
    const ai = (r.ai_answers ?? null) as Record<string, string> | null;
    const human = (r.human_answers ?? null) as Record<string, string> | null;
    if (!ai || !human) continue;
    const agreed = answersFullyMatch(ai, human) ? 1 : 0;
    samples.push({ nominal: Math.min(1, Math.max(0, conf)), agreed });
  }
  return samples;
}

async function countEligibleRows(formId: number): Promise<number> {
  const samples = await loadEligibleSamples(formId);
  return samples.length;
}

async function computeNextVersion(formId: number): Promise<number> {
  const last = await prisma.aiCalibrationMap.findFirst({
    where: { form_id: formId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

function answersFullyMatch(ai: Record<string, string>, human: Record<string, string>): boolean {
  const aiKeys = Object.keys(ai);
  const humanKeys = Object.keys(human);
  if (aiKeys.length === 0 || humanKeys.length === 0) return false;
  if (aiKeys.length !== humanKeys.length) return false;
  for (const k of aiKeys) {
    if (!(k in human)) return false;
    if (String(ai[k]).trim().toLowerCase() !== String(human[k]).trim().toLowerCase()) return false;
  }
  return true;
}
