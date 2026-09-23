/**
 * Cover for the AI spend rollup, with the emphasis on the two things most likely
 * to be wrong: folding UTC hour buckets into business days, and costing from the
 * one shared pricing table.
 *
 * These tests assume the process timezone is America/New_York, which
 * config/timezone.ts pins in every environment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.fn();

vi.mock('../../../config/database', () => ({
  default: { query: (...a: unknown[]) => poolQuery(...a) },
}));

import { getAiSpend } from '../aiSpend.service';

const bucket = (over: Partial<Record<string, unknown>> = {}) => ({
  hour_utc: '2026-09-22T13',
  purpose: 'insights.missed_opportunities',
  model: 'claude-opus-4-7',
  calls: 1,
  failed_calls: 0,
  tokens_in: 1_000_000,
  tokens_out: 0,
  ...over,
});

beforeEach(() => {
  poolQuery.mockReset();
});

describe('getAiSpend', () => {
  it('prices from the shared rate table (opus 4-7 at $5 per million input)', async () => {
    poolQuery.mockResolvedValue([[bucket()]]);
    const r = await getAiSpend(30);
    expect(r.rows[0].estimatedUsd).toBeCloseTo(5, 4);
    expect(r.totalEstimatedUsd).toBeCloseTo(5, 4);
  });

  it('charges output tokens at the output rate', async () => {
    poolQuery.mockResolvedValue([[bucket({ tokens_in: 0, tokens_out: 1_000_000 })]]);
    const r = await getAiSpend(30);
    expect(r.rows[0].estimatedUsd).toBeCloseTo(25, 4);
  });

  it('files an evening UTC hour under the business day it happened on', async () => {
    // 02:00Z on the 23rd is 22:00 on the 22nd in Eastern. A SQL DATE() would have
    // filed this under the 23rd.
    poolQuery.mockResolvedValue([[bucket({ hour_utc: '2026-09-23T02' })]]);
    const r = await getAiSpend(30);
    expect(r.rows[0].day).toBe('2026-09-22');
  });

  it('keeps a morning UTC hour on the same calendar day', async () => {
    poolQuery.mockResolvedValue([[bucket({ hour_utc: '2026-09-22T13' })]]);
    const r = await getAiSpend(30);
    expect(r.rows[0].day).toBe('2026-09-22');
  });

  it('merges hour buckets that fall in the same business day', async () => {
    poolQuery.mockResolvedValue([[
      bucket({ hour_utc: '2026-09-22T13', calls: 2, tokens_in: 500_000 }),
      bucket({ hour_utc: '2026-09-22T14', calls: 3, tokens_in: 500_000 }),
    ]]);
    const r = await getAiSpend(30);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].calls).toBe(5);
    expect(r.rows[0].tokensIn).toBe(1_000_000);
    expect(r.rows[0].estimatedUsd).toBeCloseTo(5, 4);
  });

  it('keeps different jobs and models apart, and ranks spend by job', async () => {
    poolQuery.mockResolvedValue([[
      bucket({ purpose: 'insights.sales_plays_miner', tokens_in: 2_000_000 }),
      bucket({ purpose: 'insights.missed_opportunities', tokens_in: 1_000_000 }),
      bucket({ purpose: 'insights.missed_opportunities', model: 'claude-haiku-4-5', tokens_in: 1_000_000 }),
    ]]);
    const r = await getAiSpend(30);
    expect(r.rows).toHaveLength(3);
    expect(r.byPurpose[0].purpose).toBe('insights.sales_plays_miner');
    expect(r.byPurpose[0].estimatedUsd).toBeCloseTo(10, 4);
    // opus $5 + haiku $1 on a million input tokens each.
    expect(r.byPurpose[1].estimatedUsd).toBeCloseTo(6, 4);
    expect(r.totalCalls).toBe(3);
  });

  it('counts failures without excluding their cost — a failed call still bills', async () => {
    poolQuery.mockResolvedValue([[bucket({ calls: 4, failed_calls: 1 })]]);
    const r = await getAiSpend(30);
    expect(r.rows[0].failedCalls).toBe(1);
    expect(r.rows[0].estimatedUsd).toBeCloseTo(5, 4);
  });

  it('clamps the window and passes it to the query', async () => {
    poolQuery.mockResolvedValue([[]]);
    expect((await getAiSpend(0)).windowDays).toBe(1);
    expect((await getAiSpend(500)).windowDays).toBe(90);
    expect((await getAiSpend(30)).windowDays).toBe(30);
    expect(poolQuery.mock.calls.at(-1)?.[1]).toEqual([30]);
  });

  it('ignores a malformed hour bucket rather than inventing a day', async () => {
    poolQuery.mockResolvedValue([[bucket({ hour_utc: 'not-a-date' })]]);
    const r = await getAiSpend(30);
    expect(r.rows).toHaveLength(0);
    expect(r.totalEstimatedUsd).toBe(0);
  });

  it('flags that the figures ignore prompt-cache discounts', async () => {
    poolQuery.mockResolvedValue([[bucket()]]);
    expect((await getAiSpend(30)).estimatesReadHigh).toBe(true);
  });
});
