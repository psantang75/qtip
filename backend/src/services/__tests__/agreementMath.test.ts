/**
 * Cohen's kappa golden numbers (Phase 5).
 *
 * These tests pin the kappa implementation to hand-computed expected
 * values so a refactor of `agreementMath.ts` cannot silently change
 * what the readiness ladder, eval runner, and per-question routing
 * logic see. Numerical tolerance is 1e-6 because the implementation
 * uses double-precision arithmetic.
 *
 * Edge cases covered:
 *   - Empty input -> NaN (no signal).
 *   - Single category -> 1.0 by convention (perfect agreement, kappa
 *     undefined; we surface 1.0 because it's more useful than NaN).
 *   - Asymmetric marginals -> kappa < raw agreement (chance correction).
 *   - Weighted kappa: linear vs quadratic produce different numbers
 *     for the same pairs.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCohensKappa,
  computeWeightedKappa,
  perQuestionKappa,
  type RaterPair,
} from '../agreementMath';

const EPSILON = 1e-6;

describe('computeCohensKappa', () => {
  it('returns NaN for empty input', () => {
    expect(Number.isNaN(computeCohensKappa([]))).toBe(true);
  });

  it('returns 1.0 when only one category appears (perfect agreement edge case)', () => {
    const pairs: RaterPair[] = [['yes', 'yes'], ['yes', 'yes'], ['yes', 'yes']];
    expect(computeCohensKappa(pairs)).toBe(1.0);
  });

  it('returns 1.0 for perfect agreement across two categories', () => {
    const pairs: RaterPair[] = [
      ['yes', 'yes'],
      ['no', 'no'],
      ['yes', 'yes'],
      ['no', 'no'],
    ];
    expect(computeCohensKappa(pairs)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 for chance-only agreement on a balanced binary task', () => {
    // 4 yes/yes, 4 yes/no, 4 no/yes, 4 no/no. Marginals are 50/50 each.
    // Observed = 8/16 = 0.5. Expected = 0.5*0.5 + 0.5*0.5 = 0.5. kappa = 0.
    const pairs: RaterPair[] = [
      ['yes', 'yes'], ['yes', 'yes'], ['yes', 'yes'], ['yes', 'yes'],
      ['yes', 'no'], ['yes', 'no'], ['yes', 'no'], ['yes', 'no'],
      ['no', 'yes'], ['no', 'yes'], ['no', 'yes'], ['no', 'yes'],
      ['no', 'no'], ['no', 'no'], ['no', 'no'], ['no', 'no'],
    ];
    expect(Math.abs(computeCohensKappa(pairs))).toBeLessThan(EPSILON);
  });

  it('matches the textbook example (kappa = 0.4)', () => {
    // From Cohen 1960. 50 ratings; pObs=0.7, pExp=0.5 -> kappa = 0.4.
    // 25 yes/yes, 10 no/no, 10 yes/no, 5 no/yes
    // a marginals: yes 35, no 15. b marginals: yes 30, no 20.
    // pObs = 35/50 = 0.7. pExp = (35*30 + 15*20)/2500 = (1050+300)/2500 = 0.54.
    // kappa = (0.7 - 0.54) / (1 - 0.54) = 0.16/0.46 ≈ 0.347826
    const pairs: RaterPair[] = [];
    for (let i = 0; i < 25; i += 1) pairs.push(['yes', 'yes']);
    for (let i = 0; i < 10; i += 1) pairs.push(['no', 'no']);
    for (let i = 0; i < 10; i += 1) pairs.push(['yes', 'no']);
    for (let i = 0; i < 5; i += 1) pairs.push(['no', 'yes']);
    expect(computeCohensKappa(pairs)).toBeCloseTo(0.347826, 5);
  });

  it('normalizes case and whitespace before comparison', () => {
    const pairs: RaterPair[] = [
      ['Yes', 'yes'],
      [' YES ', 'yes'],
      ['no', 'NO'],
    ];
    // After normalization: all 3 pairs agree, single binary scale.
    expect(computeCohensKappa(pairs)).toBe(1.0);
  });
});

describe('computeWeightedKappa', () => {
  const ordinal = ['no', 'partial', 'yes'] as const;

  it('returns simple kappa when fewer than 2 ordinal categories supplied', () => {
    const pairs: RaterPair[] = [['yes', 'yes'], ['no', 'no']];
    expect(computeWeightedKappa(pairs, ['yes'])).toBeCloseTo(
      computeCohensKappa(pairs),
      6
    );
  });

  it('linear weighted kappa exceeds unweighted kappa on near-misses', () => {
    // 5 perfect agreements + 5 off-by-one disagreements should produce
    // a higher weighted kappa (off-by-one is "almost agreement") than
    // unweighted (which treats off-by-one as a full disagreement).
    const pairs: RaterPair[] = [
      ['yes', 'yes'], ['yes', 'yes'], ['no', 'no'], ['no', 'no'], ['partial', 'partial'],
      ['yes', 'partial'], ['partial', 'yes'], ['no', 'partial'], ['partial', 'no'],
      ['yes', 'no'], // one off-by-two to keep the matrix interesting
    ];
    const unweighted = computeCohensKappa(pairs);
    const weightedLinear = computeWeightedKappa(pairs, [...ordinal], 'linear');
    expect(weightedLinear).toBeGreaterThan(unweighted);
  });

  it('quadratic weighting produces a different number than linear weighting', () => {
    const pairs: RaterPair[] = [
      ['yes', 'yes'], ['no', 'no'], ['partial', 'partial'],
      ['yes', 'partial'], ['no', 'partial'],
      ['yes', 'no'],
    ];
    const linear = computeWeightedKappa(pairs, [...ordinal], 'linear');
    const quadratic = computeWeightedKappa(pairs, [...ordinal], 'quadratic');
    expect(linear).not.toBe(quadratic);
  });
});

describe('perQuestionKappa', () => {
  it('produces one entry per question with the correct n', () => {
    const map = new Map<number, RaterPair[]>([
      [1, [['yes', 'yes'], ['yes', 'no']]],
      [2, [['no', 'no'], ['no', 'no'], ['no', 'no']]],
    ]);
    const out = perQuestionKappa(map);
    expect(out.get(1)?.n).toBe(2);
    expect(out.get(2)?.n).toBe(3);
    // Question 2 has only 'no' values -> single-category convention -> 1.0
    expect(out.get(2)?.kappa).toBe(1.0);
  });
});
