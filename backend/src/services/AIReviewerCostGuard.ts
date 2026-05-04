/**
 * AIReviewerCostGuard
 *
 * Enforces a per-form monthly USD cost ceiling on the AI Reviewer.
 *
 * Rationale: Anthropic/OpenAI bills are open-ended. A misconfigured form
 * (huge KB, runaway prompt, or a bot loop) can quietly burn through a
 * QA budget overnight. This guard sits on the synchronous path before
 * every LLM call so spend is bounded BY THE FORM (not the org), gives
 * QA admins a visible gauge in the settings UI, and degrades gracefully
 * to human-only review at 100%.
 *
 * Source of truth for spend: `ai_call_logs` rows tagged with
 * `form_id = X` for the calendar-month-to-date window (UTC). We sum
 * tokens per row through `estimateUsdCost`, which already understands
 * the model pricing table. No new column or table needed.
 *
 * Behaviour:
 *   - Budget unset / null  -> always allow.
 *   - MTD spend < 80% cap  -> allow (utilization ratio < 0.8).
 *   - MTD spend in 80-100% -> allow but mark `warn = true`. Caller logs
 *     a warning so the gauge in the UI flips amber.
 *   - MTD spend >= 100%    -> deny. AIReviewerService short-circuits to
 *     a "BUDGET_EXCEEDED" outcome that routes the submission to the
 *     human inbox (Day-1 fail-safe is "humans grade", never "drop on
 *     the floor").
 *
 * Cache: MTD totals are recomputed at most once per minute per form.
 * Recomputing on every call would add a SUM aggregation to the
 * synchronous path; once per minute is responsive enough for a budget
 * that's measured in dollars per day and prevents query thrash if a
 * single form gets a burst of submissions.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';
import { estimateUsdCost } from './aiCostEstimator';

const CACHE_TTL_MS = 60 * 1000;
const SOFT_WARN_RATIO = 0.8;

interface CacheEntry {
  mtdUsd: number;
  fetchedAt: number;
}

const mtdCache = new Map<number, CacheEntry>();

export interface CostGuardDecision {
  /** False when MTD spend has hit/exceeded the cap. */
  allowed: boolean;
  /** True at >= 80% of the cap (still allowed but worth a UI badge). */
  warn: boolean;
  /** Cumulative spend so far this UTC month, in USD. */
  mtdUsd: number;
  /** The form's configured monthly cap, in USD (null when none set). */
  budgetUsd: number | null;
  /** Human-readable reason. Always populated, even on `allowed=true`. */
  reason: string;
}

function utcMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Recompute MTD spend for one form by summing estimateUsdCost over every
 * `ai_call_logs` row in the current UTC month. Falls back to zero when
 * there are no rows (i.e. fresh month, or the form has never run).
 */
async function recomputeMtdUsd(formId: number): Promise<number> {
  const start = utcMonthStart();
  const rows = await prisma.aiCallLog.findMany({
    where: {
      form_id: formId,
      created_at: { gte: start },
      success: true,
    },
    select: { model: true, tokens_in: true, tokens_out: true },
  });

  let total = 0;
  for (const r of rows) {
    const est = estimateUsdCost(r.model, r.tokens_in, r.tokens_out);
    if (est && Number.isFinite(est.usd)) total += est.usd;
  }
  return total;
}

async function getCachedMtd(formId: number): Promise<number> {
  const now = Date.now();
  const cached = mtdCache.get(formId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.mtdUsd;
  const fresh = await recomputeMtdUsd(formId);
  mtdCache.set(formId, { mtdUsd: fresh, fetchedAt: now });
  return fresh;
}

/**
 * Pre-flight check: returns `allowed=true` when the form is under
 * budget, `allowed=false` when the cap has been hit. Caller is
 * responsible for short-circuiting on `allowed=false` (typically by
 * routing the submission to a human reviewer with a "BUDGET_EXCEEDED"
 * note).
 */
export async function checkBudget(formId: number): Promise<CostGuardDecision> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { ai_monthly_cost_budget_usd: true },
  });
  const budgetUsd =
    form?.ai_monthly_cost_budget_usd != null ? Number(form.ai_monthly_cost_budget_usd) : null;
  const mtdUsd = await getCachedMtd(formId);

  if (budgetUsd == null || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return {
      allowed: true,
      warn: false,
      mtdUsd,
      budgetUsd: budgetUsd ?? null,
      reason: 'No monthly cost budget configured for this form.',
    };
  }

  if (mtdUsd >= budgetUsd) {
    return {
      allowed: false,
      warn: true,
      mtdUsd,
      budgetUsd,
      reason: `Monthly AI cost budget exhausted ($${mtdUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}). Submission routed for human review.`,
    };
  }
  if (mtdUsd >= budgetUsd * SOFT_WARN_RATIO) {
    return {
      allowed: true,
      warn: true,
      mtdUsd,
      budgetUsd,
      reason: `Approaching monthly AI cost budget ($${mtdUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}; >=80%).`,
    };
  }
  return {
    allowed: true,
    warn: false,
    mtdUsd,
    budgetUsd,
    reason: `Within monthly AI cost budget ($${mtdUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}).`,
  };
}

/**
 * Read-only status for the settings UI gauge. Never throws on missing
 * data — empty form / fresh month returns mtd=0.
 */
export async function getCostStatusForForm(formId: number): Promise<CostGuardDecision> {
  return checkBudget(formId);
}

/**
 * Drop a form's cached MTD value. Call after a settings PATCH that
 * raises/lowers the budget so the next request reflects the new cap
 * without waiting for the 60s TTL.
 */
export function invalidateCostCache(formId: number): void {
  mtdCache.delete(formId);
}

/** Boot smoke signal: log how many forms have a budget set. */
export async function logCostGuardStateOnBoot(): Promise<void> {
  try {
    const count = await prisma.form.count({
      where: { ai_enabled: true, ai_monthly_cost_budget_usd: { not: null } },
    });
    logger.info(`[AI REVIEWER] cost guard: ${count} AI-enabled form(s) have monthly budgets`);
  } catch (err) {
    logger.error('[AI REVIEWER] cost guard boot probe failed', { error: (err as Error).message });
  }
}
