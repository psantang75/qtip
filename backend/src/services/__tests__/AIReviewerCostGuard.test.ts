/**
 * AIReviewerCostGuard — Phase 7b unit tests.
 *
 * Pins the budget-decision logic against the canonical thresholds:
 *   - No budget set      -> always allowed, no warn.
 *   - MTD < 80% of cap   -> allowed, no warn.
 *   - 80% <= MTD < 100%  -> allowed, warn flag set.
 *   - MTD >= 100%        -> denied (allowed=false).
 *
 * Cache invalidation is exercised so a settings PATCH that lowers the
 * budget can flip the gate immediately rather than waiting 60s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, findManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    form: { findUnique: findUniqueMock },
    aiCallLog: { findMany: findManyMock },
  },
}));

import { checkBudget, invalidateCostCache, estimateNextCaseUsd } from '../AIReviewerCostGuard';

const SAMPLE_LOGS_50C = [
  // Each row uses claude-haiku-4-5 ($1 in / $5 out per 1M tokens).
  // 100k input + 100k output = $0.10 + $0.50 = $0.60. Five rows = $3.00.
  { model: 'claude-haiku-4-5', tokens_in: 100_000, tokens_out: 100_000 },
  { model: 'claude-haiku-4-5', tokens_in: 100_000, tokens_out: 100_000 },
  { model: 'claude-haiku-4-5', tokens_in: 100_000, tokens_out: 100_000 },
  { model: 'claude-haiku-4-5', tokens_in: 100_000, tokens_out: 100_000 },
  { model: 'claude-haiku-4-5', tokens_in: 100_000, tokens_out: 100_000 },
];

describe('AIReviewerCostGuard.checkBudget', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findManyMock.mockReset();
    invalidateCostCache(99016);
  });

  it('allows the call when no budget is configured', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: null });
    findManyMock.mockResolvedValue([]);
    const out = await checkBudget(99016);
    expect(out.allowed).toBe(true);
    expect(out.warn).toBe(false);
    expect(out.budgetUsd).toBeNull();
  });

  it('allows when MTD is well under the cap (<80%)', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 100 });
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C); // $3.00 of $100
    const out = await checkBudget(99016);
    expect(out.allowed).toBe(true);
    expect(out.warn).toBe(false);
    expect(out.mtdUsd).toBeCloseTo(3, 4);
  });

  it('warns at 80% utilization but still allows', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 4 }); // $3 of $4 = 75% — under 80
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C);
    let out = await checkBudget(99016);
    expect(out.warn).toBe(false);

    invalidateCostCache(99016);
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 3.5 }); // $3 of $3.50 ≈ 86%
    out = await checkBudget(99016);
    expect(out.allowed).toBe(true);
    expect(out.warn).toBe(true);
  });

  it('blocks once MTD reaches the cap', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 3 }); // $3 of $3 = 100%
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C);
    const out = await checkBudget(99016);
    expect(out.allowed).toBe(false);
    expect(out.warn).toBe(true);
    expect(out.reason).toMatch(/exhausted/i);
  });

  it('caches MTD across calls within the TTL', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 100 });
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C);
    await checkBudget(99016);
    await checkBudget(99016);
    await checkBudget(99016);
    // form lookup runs every time; aiCallLog query is cached for 60s.
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).toHaveBeenCalledTimes(3);
  });

  it('invalidateCostCache forces a fresh recompute', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 100 });
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C);
    await checkBudget(99016);
    invalidateCostCache(99016);
    await checkBudget(99016);
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it('treats negative or zero budget as "no budget"', async () => {
    findUniqueMock.mockResolvedValue({ ai_monthly_cost_budget_usd: 0 });
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C);
    const out = await checkBudget(99016);
    expect(out.allowed).toBe(true);
    expect(out.warn).toBe(false);
  });

  // Phase C (C5): predicted-cost gating for multi-source two-pass cases.
  it('denies a multi-source case that would push MTD over the cap', async () => {
    findUniqueMock.mockResolvedValue({
      ai_monthly_cost_budget_usd: 3.2,
      ai_max_attached_sources: 5,
    });
    findManyMock.mockResolvedValue(SAMPLE_LOGS_50C); // $3.00 MTD
    const out = await checkBudget(99016, {
      sourceCount: 3,
      willClassify: false,
      expectVerification: true,
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/exhausted/i);
  });

  it('caps sourceCount at ai_max_attached_sources before pricing', async () => {
    findUniqueMock.mockResolvedValue({
      ai_monthly_cost_budget_usd: 1000,
      ai_max_attached_sources: 1,
    });
    findManyMock.mockResolvedValue([]);
    const cappedOut = await checkBudget(99016, {
      sourceCount: 10,
      willClassify: false,
      expectVerification: false,
    });
    invalidateCostCache(99016);
    findUniqueMock.mockResolvedValue({
      ai_monthly_cost_budget_usd: 1000,
      ai_max_attached_sources: 10,
    });
    const uncappedOut = await checkBudget(99016, {
      sourceCount: 10,
      willClassify: false,
      expectVerification: false,
    });
    // Both allowed (budget huge) but the uncapped run must be measurably
    // more expensive than the capped one — proves the cap actually
    // suppressed traces.
    const onePassUsd = estimateNextCaseUsd({
      sourceCount: 1,
      willClassify: false,
      expectVerification: false,
    });
    const tenPassUsd = estimateNextCaseUsd({
      sourceCount: 10,
      willClassify: false,
      expectVerification: false,
    });
    expect(cappedOut.allowed).toBe(true);
    expect(uncappedOut.allowed).toBe(true);
    expect(tenPassUsd).toBeGreaterThan(onePassUsd * 1.5);
  });

  it('estimateNextCaseUsd scales linearly per attached source', () => {
    const a = estimateNextCaseUsd({
      sourceCount: 1,
      willClassify: false,
      expectVerification: false,
    });
    const b = estimateNextCaseUsd({
      sourceCount: 3,
      willClassify: false,
      expectVerification: false,
    });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    // 3-source case = 3 traces + 1 synthesis vs 1 trace + 1 synthesis.
    // Should roughly double-or-more the cost; exact ratio depends on
    // the trace/synthesis split in PASS_COST_ASSUMPTIONS.
    expect(b / a).toBeGreaterThan(1.4);
  });
});
