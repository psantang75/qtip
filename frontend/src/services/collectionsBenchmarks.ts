/**
 * Published industry benchmarks for the Collections dashboards, kept in one
 * place so KPI tiles and the Campaign × Touch overlay read from a single
 * source. Figures are from subscription-dunning recovery studies (Recurly /
 * Stripe / Chargebee) and the collections / ARM KPI canon (Finvi, FICO,
 * Thomson Reuters), 2025-2026.
 */

/** Subscription-industry median failed-payment recovery rate (%). */
export const RECOVERY_MEDIAN_PCT = 47.6

/** Industry cost-per-dollar-collected target (best-in-class, USD). */
export const COST_PER_DOLLAR_TARGET = 0.1

/** Typical time-to-recovery window (days) — goal / warn used on the tile. */
export const TIME_TO_RECOVERY = { goalDays: 5, warnDays: 7 }

/**
 * Cumulative recovery/contact rate by attempt (%). Front-loaded with a hard
 * plateau after attempt 5 — the reference line overlaid on the Campaign ×
 * Touch waterfall so the "is touch 4 a waste" question reads against industry.
 * Index = touch number (1-based); values are cumulative.
 */
export const CUMULATIVE_RECOVERY_BY_ATTEMPT: number[] = [24, 37, 45, 49, 50, 51, 51, 52]

/** Cumulative benchmark at a given touch (clamped to the last known value). */
export function benchmarkCumulativeAt(touchSeq: number): number {
  if (touchSeq <= 0) return 0
  const i = Math.min(touchSeq, CUMULATIVE_RECOVERY_BY_ATTEMPT.length) - 1
  return CUMULATIVE_RECOVERY_BY_ATTEMPT[i]
}
