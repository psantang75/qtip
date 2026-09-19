/**
 * TEMP COST ESTIMATOR — non-persistent per-run USD cost estimate for
 * every LLM call the AI Reviewer makes.
 *
 *   - Pure helper, NO database column. Every call-site is prefixed
 *     `TEMP COST ESTIMATOR` in stdout so this module is trivially
 *     greppable when we strip it later.
 *   - Lives next to AIReviewerService (the only consumer) rather than
 *     in config/ on purpose: it's intentionally throwaway, and we
 *     don't want anyone wiring it into long-lived dashboards or
 *     report exports while it's still labeled TEMP.
 *
 * Pricing notes:
 *   - Numbers are in USD per 1M tokens (input/output). Update the
 *     `PRICING` map when providers change rates. The fallback rate
 *     keeps us emitting a number even if a model isn't in the table —
 *     better a rough estimate with a warning than no signal at all.
 */

import logger from '../config/logger';

/**
 * Per-million-token pricing in USD. Update as Anthropic/OpenAI publish new rates.
 *
 * Rates verified against the live Anthropic + OpenAI pricing pages (April 2026).
 * Keys are lowercased before lookup, so register the exact model id you pass to
 * the SDK PLUS any alias the SDK might collapse to (e.g. "claude-haiku-4-5" and
 * the dated "claude-haiku-4-5-20251001").
 */
const PRICING: Record<string, { in: number; out: number }> = {
  // ----- Anthropic — Haiku ------------------------------------------------
  // Kept for back-compat: prior AI Reviewer default + still used by some
  // ad-hoc scripts. Production default is now claude-opus-4-7 (see
  // ANTHROPIC_DEFAULT_MODEL in backend/src/config/environment.ts).
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-haiku-3-5': { in: 0.8, out: 4.0 },
  'claude-3-5-haiku-latest': { in: 0.8, out: 4.0 },
  // ----- Anthropic — Sonnet -----------------------------------------------
  'claude-3-5-sonnet-20240620': { in: 3.0, out: 15.0 },
  'claude-3-5-sonnet-20241022': { in: 3.0, out: 15.0 },
  'claude-3-5-sonnet-latest': { in: 3.0, out: 15.0 },
  'claude-3-7-sonnet-20250219': { in: 3.0, out: 15.0 },
  'claude-3-7-sonnet-latest': { in: 3.0, out: 15.0 },
  'claude-sonnet-4-20250514': { in: 3.0, out: 15.0 },
  'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  // ----- Anthropic — Opus -------------------------------------------------
  'claude-opus-4-5': { in: 5.0, out: 25.0 },
  'claude-opus-4-6': { in: 5.0, out: 25.0 },
  'claude-opus-4-7': { in: 5.0, out: 25.0 },
  // ----- OpenAI — gpt-5 family --------------------------------------------
  'gpt-5': { in: 1.25, out: 10.0 },
  'gpt-5-mini': { in: 0.25, out: 2.0 },
  'gpt-5-mini-2025-08-07': { in: 0.25, out: 2.0 },
  'gpt-5-nano': { in: 0.05, out: 0.4 },
  // ----- OpenAI — gpt-4o / gpt-4.1 ranges (kept for back-compat) ----------
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-2024-11-20': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4.1': { in: 2.5, out: 10.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
};

/** Used when the model isn't in the pricing table — better some signal than none. */
const FALLBACK_PRICING = { in: 3.0, out: 15.0 };

/**
 * Prompt-cache multipliers on the base INPUT rate (Anthropic ephemeral cache):
 *   - a cache READ bills at 10% of base input — the whole point of caching;
 *   - a 5-minute cache WRITE bills at 125% of base input, a one-time premium
 *     recovered after the second hit.
 * Applied to whichever model's base input rate is in effect, so they track any
 * future rate change automatically. Provider docs:
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface CostEstimate {
  /** USD cost as a plain number, e.g. 0.0123. */
  usd: number;
  /** Pretty-printed cost, e.g. "$0.0123". */
  formatted: string;
  /** Token counts the estimate was derived from (echoed for debugging). */
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** Whether we used the fallback pricing (model not in PRICING table). */
  approximated: boolean;
}

/**
 * Estimate USD cost for one LLM call. Returns null when no token category is
 * known — without a token count there's nothing meaningful to report.
 *
 * `inputTokens` is the UNCACHED input (billed at the base rate). When prompt
 * caching is in play, pass the cache read/write counts separately so they are
 * priced at their own rates; omitting them (the default) reproduces the old
 * uncached-only behaviour exactly, which is what every non-caching call site
 * still relies on. The echoed `inputTokens` is the TOTAL input across all three
 * categories, so it stays comparable to what the provider reports as volume.
 */
export function estimateUsdCost(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  cacheReadTokens?: number | null,
  cacheWriteTokens?: number | null
): CostEstimate | null {
  const inT = Number(inputTokens ?? 0);
  const outT = Number(outputTokens ?? 0);
  const readT = Number(cacheReadTokens ?? 0);
  const writeT = Number(cacheWriteTokens ?? 0);
  if (
    !Number.isFinite(inT) ||
    !Number.isFinite(outT) ||
    !Number.isFinite(readT) ||
    !Number.isFinite(writeT) ||
    inT + outT + readT + writeT <= 0
  ) {
    return null;
  }

  const m = String(model ?? '').toLowerCase().trim();
  let pricing = PRICING[m];
  let approximated = false;
  if (!pricing) {
    pricing = FALLBACK_PRICING;
    approximated = true;
    logger.warn(
      `[AI REVIEWER] TEMP COST ESTIMATOR: model "${model}" not in pricing table; using fallback ($${pricing.in}/$${pricing.out} per 1M tok).`
    );
  }
  const usd =
    (inT / 1_000_000) * pricing.in +
    (readT / 1_000_000) * pricing.in * CACHE_READ_MULTIPLIER +
    (writeT / 1_000_000) * pricing.in * CACHE_WRITE_MULTIPLIER +
    (outT / 1_000_000) * pricing.out;
  return {
    usd,
    formatted: formatUsdCost(usd),
    inputTokens: inT + readT + writeT,
    outputTokens: outT,
    model: String(model ?? '(unknown)'),
    approximated,
  };
}

/** Pretty-print a USD cost. Sub-cent precision because individual reviews are cheap. */
export function formatUsdCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.0000';
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  if (Math.abs(usd) < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
