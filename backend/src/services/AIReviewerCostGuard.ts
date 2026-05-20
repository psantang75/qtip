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

/**
 * Phase C (C5): rough average per-pass token usage. Used to predict
 * the cost of the *next* run before we make the LLM calls so we can
 * deny multi-source cases that would push us over the cap, instead of
 * only catching them post-hoc on the next request.
 *
 * These are deliberately conservative (skewed slightly high) so the
 * predicted cost is an upper bound on the typical case and we err on
 * the side of denying borderline runs rather than overshooting the
 * configured budget. Numbers come from the median of recent
 * `ai_call_logs` rows for each pass; revisit when prompt sizes change
 * meaningfully (e.g. a major KB expansion).
 */
const PASS_COST_ASSUMPTIONS = {
  /** Per-source trace pass (Sonnet). One per attached source. */
  trace: { model: 'claude-sonnet-4-6', inTokens: 9000, outTokens: 1500 },
  /** Cross-source synthesis pass (Opus). Always exactly one. */
  synthesis: { model: 'claude-opus-4-7', inTokens: 6000, outTokens: 1500 },
  /** Optional self-consistency verification (Opus). At most one. */
  verification: { model: 'claude-opus-4-7', inTokens: 4000, outTokens: 800 },
  /** Mini-LLM call topic classifier on call-only reviews (Sonnet). */
  classification: { model: 'claude-sonnet-4-6', inTokens: 1500, outTokens: 200 },
} as const;

export interface CostGuardCaseShape {
  /**
   * Number of attached sources (tickets/calls/tasks) that will be
   * traced individually before synthesis. Always >= 1. Capped against
   * the form's `ai_max_attached_sources` setting by the caller.
   */
  sourceCount: number;
  /** True when a Sonnet-based topic classifier will run first. */
  willClassify: boolean;
  /**
   * True when we expect to run the verification pass. AIReviewerService
   * only fires verification on low confidence / self-consistency
   * warnings, so callers can pass `true` when they want a worst-case
   * estimate or `false` for a typical-case estimate.
   */
  expectVerification: boolean;
}

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
 * Phase C (C5): predict the USD cost of the next AI Reviewer run for
 * a given case shape. Multi-source cases pay for N Sonnet traces +
 * 1 Opus synthesis (+ optional verification + optional classifier);
 * single-source cases collapse to the legacy 1-pass cost. The N here
 * is already capped by the caller against `ai_max_attached_sources`.
 *
 * Returns 0 when sourceCount <= 0, which lets callers safely call this
 * before they know the case shape.
 */
export function estimateNextCaseUsd(shape: CostGuardCaseShape): number {
  const n = Math.max(0, Math.floor(shape.sourceCount));
  if (n <= 0) return 0;
  let total = 0;
  if (shape.willClassify) {
    const c = PASS_COST_ASSUMPTIONS.classification;
    const est = estimateUsdCost(c.model, c.inTokens, c.outTokens);
    if (est) total += est.usd;
  }
  for (let i = 0; i < n; i++) {
    const t = PASS_COST_ASSUMPTIONS.trace;
    const est = estimateUsdCost(t.model, t.inTokens, t.outTokens);
    if (est) total += est.usd;
  }
  const s = PASS_COST_ASSUMPTIONS.synthesis;
  const synthEst = estimateUsdCost(s.model, s.inTokens, s.outTokens);
  if (synthEst) total += synthEst.usd;
  if (shape.expectVerification) {
    const v = PASS_COST_ASSUMPTIONS.verification;
    const vEst = estimateUsdCost(v.model, v.inTokens, v.outTokens);
    if (vEst) total += vEst.usd;
  }
  return total;
}

/**
 * Pre-flight check: returns `allowed=true` when the form is under
 * budget, `allowed=false` when the cap has been hit. Caller is
 * responsible for short-circuiting on `allowed=false` (typically by
 * routing the submission to a human reviewer with a "BUDGET_EXCEEDED"
 * note).
 *
 * Phase C (C5): when `caseShape` is supplied, the projected cost of
 * the next run (N Sonnet traces + 1 Opus synthesis + optional passes)
 * is added to MTD before comparing to the cap. Without a caseShape we
 * fall back to the legacy MTD-only check used by the settings UI.
 */
export async function checkBudget(
  formId: number,
  caseShape?: CostGuardCaseShape
): Promise<CostGuardDecision> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { ai_monthly_cost_budget_usd: true, ai_max_attached_sources: true },
  });
  const budgetUsd =
    form?.ai_monthly_cost_budget_usd != null ? Number(form.ai_monthly_cost_budget_usd) : null;
  const mtdUsd = await getCachedMtd(formId);

  // Cap predicted source count against the form's hard cap. Without a
  // shape we don't know the next run's profile, so projected = 0.
  const cappedShape = caseShape
    ? {
        ...caseShape,
        sourceCount: Math.min(
          Math.max(1, caseShape.sourceCount || 1),
          Number(form?.ai_max_attached_sources ?? caseShape.sourceCount ?? 1)
        ),
      }
    : undefined;
  const projectedUsd = cappedShape ? estimateNextCaseUsd(cappedShape) : 0;
  const totalUsd = mtdUsd + projectedUsd;

  if (budgetUsd == null || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return {
      allowed: true,
      warn: false,
      mtdUsd,
      budgetUsd: budgetUsd ?? null,
      reason: 'No monthly cost budget configured for this form.',
    };
  }

  if (totalUsd >= budgetUsd) {
    const projectedHint = projectedUsd > 0 ? ` + projected $${projectedUsd.toFixed(2)}` : '';
    return {
      allowed: false,
      warn: true,
      mtdUsd,
      budgetUsd,
      reason: `Monthly AI cost budget exhausted ($${mtdUsd.toFixed(2)}${projectedHint} of $${budgetUsd.toFixed(2)}). Submission routed for human review.`,
    };
  }
  if (totalUsd >= budgetUsd * SOFT_WARN_RATIO) {
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
