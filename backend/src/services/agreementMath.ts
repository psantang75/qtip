/**
 * Inter-rater agreement math used by AICalibrationService and the
 * golden-set eval runner. Centralized here so both consumers compute
 * the same number for the same input.
 *
 * Cohen's kappa formula:
 *   kappa = (P_observed - P_expected) / (1 - P_expected)
 *   where P_expected accounts for chance agreement based on each
 *   rater's marginal distribution.
 *
 * Interpretation:
 *   < 0.0  → worse than chance
 *   0.0–0.2 → slight
 *   0.2–0.4 → fair
 *   0.4–0.6 → moderate
 *   0.6–0.8 → substantial
 *   0.8–1.0 → almost perfect
 *   1.0    → perfect agreement
 */

export type RaterPair = readonly [string, string];

/**
 * Simple (unweighted) Cohen's kappa for nominal categorical data.
 * Returns NaN when there's not enough data to compute.
 */
export function computeCohensKappa(pairs: RaterPair[]): number {
  if (pairs.length === 0) return Number.NaN;
  const n = pairs.length;

  // Build the union of categories that actually appeared on either side.
  const categories = new Set<string>();
  for (const [a, b] of pairs) {
    categories.add(normalize(a));
    categories.add(normalize(b));
  }
  if (categories.size === 1) {
    // Both raters always picked the same single category — agreement is
    // 1.0 by construction, but kappa is undefined (P_expected = 1, so
    // denominator is 0). Return 1.0 by convention since perfect agreement
    // is more useful to surface than NaN.
    return 1.0;
  }

  // Marginal counts.
  const aCounts = new Map<string, number>();
  const bCounts = new Map<string, number>();
  let agree = 0;
  for (const [aRaw, bRaw] of pairs) {
    const a = normalize(aRaw);
    const b = normalize(bRaw);
    aCounts.set(a, (aCounts.get(a) ?? 0) + 1);
    bCounts.set(b, (bCounts.get(b) ?? 0) + 1);
    if (a === b) agree += 1;
  }
  const pObs = agree / n;
  let pExp = 0;
  for (const c of categories) {
    const pa = (aCounts.get(c) ?? 0) / n;
    const pb = (bCounts.get(c) ?? 0) / n;
    pExp += pa * pb;
  }
  if (pExp >= 1) return 1.0;
  return (pObs - pExp) / (1 - pExp);
}

/**
 * Weighted Cohen's kappa for ordinal categorical data, with linear
 * weights by default (off-by-one disagreements weighted less than
 * off-by-many). Pass `quadratic` for quadratic weighting (used by
 * Krippendorff and many medical-grading studies).
 *
 * `categoriesInOrder` provides the ordinal sequence; values not in
 * the list are treated as nominal (max distance).
 */
export function computeWeightedKappa(
  pairs: RaterPair[],
  categoriesInOrder: readonly string[],
  weighting: 'linear' | 'quadratic' = 'linear'
): number {
  if (pairs.length === 0) return Number.NaN;
  if (categoriesInOrder.length < 2) return computeCohensKappa(pairs);

  const indexBy = new Map(categoriesInOrder.map((c, i) => [normalize(c), i]));
  const k = categoriesInOrder.length;
  const maxDistance = k - 1;

  // Confusion matrix counts[a][b] = number of (a, b) pairs.
  const counts: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const aMargin: number[] = Array(k).fill(0);
  const bMargin: number[] = Array(k).fill(0);
  let n = 0;
  for (const [aRaw, bRaw] of pairs) {
    const ai = indexBy.get(normalize(aRaw));
    const bi = indexBy.get(normalize(bRaw));
    if (ai == null || bi == null) continue; // skip values not in the ordinal scale
    counts[ai][bi] += 1;
    aMargin[ai] += 1;
    bMargin[bi] += 1;
    n += 1;
  }
  if (n === 0) return Number.NaN;

  // Weight matrix. weight=1 means perfect agreement contributes fully;
  // disagreements contribute (1 - distance / maxDistance) for linear, or
  // (1 - (distance / maxDistance)^2) for quadratic.
  const weightFor = (i: number, j: number): number => {
    const d = Math.abs(i - j);
    if (d === 0) return 1;
    const ratio = d / maxDistance;
    return weighting === 'quadratic' ? 1 - ratio * ratio : 1 - ratio;
  };

  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const w = weightFor(i, j);
      observed += w * (counts[i][j] / n);
      expected += w * ((aMargin[i] / n) * (bMargin[j] / n));
    }
  }
  if (expected >= 1) return 1.0;
  return (observed - expected) / (1 - expected);
}

/**
 * Per-question kappa given a list of (ai_value, human_value) pairs.
 * Returns NaN when the list is empty. Intended for building the
 * "rolling per-question agreement" cache for disagreement-driven
 * sampling.
 */
export function perQuestionKappa(
  pairsByQuestionId: Map<number, RaterPair[]>
): Map<number, { kappa: number; n: number }> {
  const out = new Map<number, { kappa: number; n: number }>();
  for (const [qid, pairs] of pairsByQuestionId.entries()) {
    out.set(qid, { kappa: computeCohensKappa(pairs), n: pairs.length });
  }
  return out;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}
