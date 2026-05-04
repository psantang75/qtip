/**
 * AICalibrationAbsorbSweep
 *
 * Hybrid auto-absorb mechanism for the AI Reviewer learned-corrections
 * loop. Calibration rows that are older than the form's
 * `ai_calibration_auto_absorb_days` (default 180) get
 * `absorbed_at = NOW()` set so they stop being injected as few-shot
 * examples on new AI runs. They remain in the rolling agreement / kappa
 * stats — this is a "stop teaching" knob, not a delete.
 *
 * Why hybrid?
 *   - Manual: a QA admin clicking "Mark absorbed" after editing a rule
 *     pack is the most accurate signal. It captures the WHY in
 *     `absorbed_reason` (typically the pack name + version).
 *   - Automatic: humans forget. Without a safety net, the few-shot
 *     budget gradually fills with stale corrections that nobody
 *     remembers existed. The 180-day default is long enough that any
 *     real lesson has had multiple rule-pack edit cycles to be
 *     captured manually first, but short enough that the budget stays
 *     fresh.
 *
 * Runs:
 *   1. Once on server boot (via runAbsorbSweepOnBoot)
 *   2. Daily via the scheduler (registerScheduledAbsorbSweep)
 */

import prisma from '../config/prisma';
import logger from '../config/logger';

/** Hard cap for the form-level setting if NULL or invalid. */
const FALLBACK_AUTO_ABSORB_DAYS = 180;

export interface AbsorbSweepResult {
  /** Total rows updated across all forms. */
  rowsAbsorbed: number;
  /** Per-form breakdown for diagnostic logging. */
  perForm: Array<{ form_id: number; absorbed: number; cutoff_days: number }>;
}

/**
 * Run the sweep once. Idempotent — re-running is a no-op if all eligible
 * rows are already absorbed.
 *
 * Strategy: load every AI-enabled form's auto-absorb-days setting, then
 * issue one bulk update per form. Bulk-per-form (instead of one giant
 * update with a CASE expression) keeps the SQL trivial and lets each
 * update use the (form_id, absorbed_at) index efficiently.
 */
export async function runCalibrationAbsorbSweep(): Promise<AbsorbSweepResult> {
  const forms = await prisma.form.findMany({
    where: { ai_enabled: true },
    select: { id: true, ai_calibration_auto_absorb_days: true },
  });

  const now = new Date();
  const perForm: AbsorbSweepResult['perForm'] = [];
  let rowsAbsorbed = 0;

  for (const f of forms) {
    const days =
      f.ai_calibration_auto_absorb_days != null && f.ai_calibration_auto_absorb_days > 0
        ? f.ai_calibration_auto_absorb_days
        : FALLBACK_AUTO_ABSORB_DAYS;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const result = await prisma.aiCalibrationData.updateMany({
      where: {
        form_id: f.id,
        absorbed_at: null,
        created_at: { lt: cutoff },
      },
      data: {
        absorbed_at: now,
        absorbed_reason: `auto-absorbed (>${days} days)`,
      },
    });
    if (result.count > 0) {
      perForm.push({ form_id: f.id, absorbed: result.count, cutoff_days: days });
      rowsAbsorbed += result.count;
    }
  }

  return { rowsAbsorbed, perForm };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Module-level guard so we only register the daily interval once even if boot is retried. */
let dailyIntervalRegistered = false;

/**
 * Smoke-signal #1: run the sweep on server boot AND register a daily
 * setInterval so the absorb mechanism keeps running without depending
 * on an external scheduler (the codebase doesn't have one). Failures
 * are caught + logged but do NOT block boot — the absorb mechanism is
 * non-critical to serving requests.
 */
export async function runAbsorbSweepOnBoot(): Promise<void> {
  try {
    const result = await runCalibrationAbsorbSweep();
    logger.info(`[AI REVIEWER] absorb sweep: ${result.rowsAbsorbed} rows auto-absorbed`);
    for (const p of result.perForm) {
      logger.info(
        `[AI REVIEWER] absorb sweep: form_id=${p.form_id} absorbed=${p.absorbed} cutoff=${p.cutoff_days}d`
      );
    }
  } catch (err) {
    logger.error('[AI REVIEWER] absorb sweep failed on boot', { error: (err as Error).message });
  }

  if (!dailyIntervalRegistered) {
    dailyIntervalRegistered = true;
    const interval = setInterval(async () => {
      try {
        const result = await runCalibrationAbsorbSweep();
        logger.info(`[AI REVIEWER] daily absorb sweep: ${result.rowsAbsorbed} rows auto-absorbed`);
      } catch (err) {
        logger.error('[AI REVIEWER] daily absorb sweep failed', { error: (err as Error).message });
      }
    }, DAY_MS);
    // unref() lets the process exit cleanly even with the interval pending.
    if (typeof interval.unref === 'function') interval.unref();
  }
}
