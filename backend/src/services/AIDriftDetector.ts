/**
 * AIDriftDetector
 *
 * Detects input/output distribution drift for the AI Reviewer.
 *
 * Drift = the inputs the AI is grading today look statistically different
 * from the inputs we calibrated the prompt against. When that happens, a
 * model that previously hit kappa 0.7 silently degrades because it's now
 * working in a regime nobody validated. Drift detection catches that
 * BEFORE the kappa drops show up in human-reviewed batches.
 *
 * Design choices:
 *
 *   1. We snapshot per-form daily. The metrics we track are intentionally
 *      minimal and DB-local — no CRM round trips on the daily job:
 *        - submission count
 *        - avg total_score
 *        - avg ai_overall_confidence (nominal)
 *        - avg ai_calibrated_confidence (post-calibrator)
 *        - score variance (catches "AI is converging on one number")
 *      We do NOT pull CRM ticket length or subclass mix here because
 *      that would mean N CRM calls per day per form. If we need that
 *      later, it can graduate to its own opt-in metric.
 *
 *   2. Snapshots are stored as a tiny JSON file per form
 *      (`backend/data/drift/<form-id>.json`) keeping the last 90 days.
 *      No new table — this is low-cardinality time series, files are
 *      simpler and cheaper than a wide-but-empty SQL table for a feature
 *      that is monitoring-only.
 *
 *   3. Alerting compares today's value against the trailing 12-week
 *      mean ± 2 SD. Anything outside that band is flagged. Two SD covers
 *      ~95% of normal variation, so a flag should be uncommon enough to
 *      take seriously without being noisy.
 *
 *   4. The boot wrapper runs once on startup and once per day via
 *      setInterval (matching the absorb sweep pattern). No external
 *      scheduler dependency.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import prisma from '../config/prisma';
import logger from '../config/logger';

const DRIFT_DIR = path.join(process.cwd(), 'data', 'drift');
const HISTORY_LIMIT_DAYS = 90;
const BASELINE_DAYS = 12 * 7; // 12-week baseline
const ALERT_SD_THRESHOLD = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DriftSnapshot {
  /** YYYY-MM-DD UTC. */
  date: string;
  submissions: number;
  avg_score: number | null;
  avg_nominal_confidence: number | null;
  avg_calibrated_confidence: number | null;
  /** Population variance of total_score across the day. */
  score_variance: number | null;
}

export type DriftMetricKey =
  | 'avg_score'
  | 'avg_nominal_confidence'
  | 'avg_calibrated_confidence'
  | 'score_variance';

export interface DriftAlert {
  metric: DriftMetricKey;
  today: number;
  baseline_mean: number;
  baseline_sd: number;
  z_score: number;
}

export interface DriftStatus {
  form_id: number;
  /** Latest snapshot we wrote. */
  latest: DriftSnapshot | null;
  /** Trailing baseline mean per metric (for UI display). */
  baseline: Partial<Record<DriftMetricKey, { mean: number; sd: number; n: number }>>;
  /** Any metric whose latest reading is > 2 SD from baseline. */
  alerts: DriftAlert[];
  /** Last 90 days of snapshots, oldest first. */
  history: DriftSnapshot[];
}

function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DRIFT_DIR, { recursive: true });
}

function fileFor(formId: number): string {
  return path.join(DRIFT_DIR, `${formId}.json`);
}

async function readHistory(formId: number): Promise<DriftSnapshot[]> {
  try {
    const raw = await fs.readFile(fileFor(formId), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.date === 'string') as DriftSnapshot[];
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    logger.warn(`[AI REVIEWER] drift: could not read history for form ${formId}`, {
      error: (err as Error).message,
    });
    return [];
  }
}

async function writeHistory(formId: number, history: DriftSnapshot[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(fileFor(formId), JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Compute today's snapshot for a single form using the trailing 24h
 * window of submissions. Returns null when there were no submissions
 * (we don't insert empty rows — they'd skew baselines).
 */
export async function computeTodaySnapshot(formId: number): Promise<DriftSnapshot | null> {
  const since = new Date(Date.now() - DAY_MS);
  const rows = await prisma.submission.findMany({
    where: {
      form_id: formId,
      submitted_at: { gte: since },
    },
    select: {
      total_score: true,
      ai_overall_confidence: true,
      ai_calibrated_confidence: true,
    },
  });
  if (rows.length === 0) return null;

  const scores = rows
    .map((r) => (r.total_score != null ? Number(r.total_score) : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const noms = rows
    .map((r) => (r.ai_overall_confidence != null ? Number(r.ai_overall_confidence) : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const calibs = rows
    .map((r) => (r.ai_calibrated_confidence != null ? Number(r.ai_calibrated_confidence) : null))
    .filter((v): v is number => v != null && Number.isFinite(v));

  const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const variance = (xs: number[]): number | null => {
    if (xs.length < 2) return null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  };

  return {
    date: todayUtcKey(),
    submissions: rows.length,
    avg_score: avg(scores),
    avg_nominal_confidence: avg(noms),
    avg_calibrated_confidence: avg(calibs),
    score_variance: variance(scores),
  };
}

function trimHistory(history: DriftSnapshot[]): DriftSnapshot[] {
  if (history.length <= HISTORY_LIMIT_DAYS) return history;
  return history.slice(history.length - HISTORY_LIMIT_DAYS);
}

function upsertSnapshot(history: DriftSnapshot[], snap: DriftSnapshot): DriftSnapshot[] {
  const idx = history.findIndex((h) => h.date === snap.date);
  if (idx === -1) return trimHistory([...history, snap]);
  // Replace same-day snapshot — last write wins (covers re-runs in the
  // same day, e.g. boot retry after a crash).
  const next = history.slice();
  next[idx] = snap;
  return trimHistory(next);
}

function meanAndSd(xs: number[]): { mean: number; sd: number } | null {
  if (xs.length < 5) return null; // refuse to alert on too-thin a baseline
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return { mean, sd: Math.sqrt(variance) };
}

function deriveStatus(formId: number, history: DriftSnapshot[]): DriftStatus {
  const latest = history.length === 0 ? null : history[history.length - 1];
  const baseline: DriftStatus['baseline'] = {};
  const alerts: DriftAlert[] = [];

  if (latest && history.length > 1) {
    const baselineWindow = history.slice(-1 - BASELINE_DAYS, -1); // exclude today
    const metrics: DriftMetricKey[] = [
      'avg_score',
      'avg_nominal_confidence',
      'avg_calibrated_confidence',
      'score_variance',
    ];
    for (const m of metrics) {
      const xs = baselineWindow
        .map((s) => s[m])
        .filter((v): v is number => v != null && Number.isFinite(v));
      const stat = meanAndSd(xs);
      if (!stat) continue;
      baseline[m] = { mean: stat.mean, sd: stat.sd, n: xs.length };

      const today = latest[m];
      if (today == null || !Number.isFinite(today)) continue;
      // SD of zero (constant baseline) -> any change is "infinite SDs". Skip
      // rather than spam alerts. This covers brand-new metrics where every
      // historical value is identical.
      if (stat.sd === 0) continue;
      const z = (today - stat.mean) / stat.sd;
      if (Math.abs(z) >= ALERT_SD_THRESHOLD) {
        alerts.push({
          metric: m,
          today,
          baseline_mean: stat.mean,
          baseline_sd: stat.sd,
          z_score: z,
        });
      }
    }
  }

  return { form_id: formId, latest, baseline, alerts, history };
}

/**
 * Run the snapshot-and-alert sweep across every AI-enabled form. Errors
 * are caught + logged per form so one form's failure doesn't kill the
 * sweep.
 */
export async function runDriftSweep(): Promise<{
  forms: number;
  alerts: number;
  perForm: Array<{ form_id: number; alerts: number; submissions: number }>;
}> {
  const forms = await prisma.form.findMany({
    where: { ai_enabled: true },
    select: { id: true },
  });

  let totalAlerts = 0;
  const perForm: Array<{ form_id: number; alerts: number; submissions: number }> = [];

  for (const f of forms) {
    try {
      const snap = await computeTodaySnapshot(f.id);
      if (!snap) {
        perForm.push({ form_id: f.id, alerts: 0, submissions: 0 });
        continue;
      }
      const history = await readHistory(f.id);
      const updated = upsertSnapshot(history, snap);
      await writeHistory(f.id, updated);
      const status = deriveStatus(f.id, updated);
      totalAlerts += status.alerts.length;
      perForm.push({ form_id: f.id, alerts: status.alerts.length, submissions: snap.submissions });
      for (const a of status.alerts) {
        logger.warn(
          `[AI REVIEWER] drift: form_id=${f.id} metric=${a.metric} z=${a.z_score.toFixed(2)} today=${a.today.toFixed(3)} baseline_mean=${a.baseline_mean.toFixed(3)}`
        );
      }
    } catch (err) {
      logger.error('[AI REVIEWER] drift sweep failed for form', {
        form_id: f.id,
        error: (err as Error).message,
      });
    }
  }

  return { forms: forms.length, alerts: totalAlerts, perForm };
}

/** Read-only status for the per-form UI. Returns empty arrays when no history exists yet. */
export async function getDriftStatusForForm(formId: number): Promise<DriftStatus> {
  const history = await readHistory(formId);
  return deriveStatus(formId, history);
}

let dailyIntervalRegistered = false;

export async function runDriftSweepOnBoot(): Promise<void> {
  try {
    const result = await runDriftSweep();
    logger.info(
      `[AI REVIEWER] drift sweep: ${result.forms} forms snapshotted, ${result.alerts} alerts`
    );
  } catch (err) {
    logger.error('[AI REVIEWER] drift sweep failed on boot', { error: (err as Error).message });
  }
  if (!dailyIntervalRegistered) {
    dailyIntervalRegistered = true;
    const interval = setInterval(async () => {
      try {
        const result = await runDriftSweep();
        logger.info(
          `[AI REVIEWER] daily drift sweep: ${result.forms} forms snapshotted, ${result.alerts} alerts`
        );
      } catch (err) {
        logger.error('[AI REVIEWER] daily drift sweep failed', { error: (err as Error).message });
      }
    }, DAY_MS);
    if (typeof interval.unref === 'function') interval.unref();
  }
}
