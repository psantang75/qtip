/**
 * resolvePriorBusinessDay regression cover.
 *
 * The bug this guards: the primary pool runs `timezone: 'Z'`, so mysql2 hydrates
 * a DATE column as UTC midnight. Formatting that with local getters under the
 * pinned America/New_York process timezone lands on the previous calendar day,
 * which silently shifted every scheduled Missed Opportunities run one business
 * day early — grading Thursday on Monday, and resolving Sunday on Tuesday, where
 * the absence of calls produced an empty run and no report.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.fn();

vi.mock('../../../../config/database', () => ({
  default: { query: (...a: unknown[]) => poolQuery(...a) },
}));

// workerSupport also pulls in Prisma for replaceFindings; stubbed so importing
// the module under test doesn't spin up a client.
vi.mock('../../../../config/prisma', () => ({
  default: { $transaction: vi.fn() },
}));

import { resolvePriorBusinessDay } from '../workerSupport';

beforeEach(() => {
  poolQuery.mockReset();
});

describe('resolvePriorBusinessDay', () => {
  it('returns the business day the dimension selected, not the day before it', async () => {
    poolQuery.mockResolvedValue([[{ business_day: '2026-09-22' }]]);
    await expect(resolvePriorBusinessDay()).resolves.toBe('2026-09-22');
  });

  it('formats the date in SQL so no timezone is applied to it', async () => {
    poolQuery.mockResolvedValue([[{ business_day: '2026-09-18' }]]);
    await resolvePriorBusinessDay();
    const sql = String(poolQuery.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("DATE_FORMAT(full_date, '%Y-%m-%d')");
    expect(sql).toContain('is_business_day = 1');
  });

  it('ignores a Date object, which would carry UTC midnight into a local read', async () => {
    // Belt and braces: if the SELECT ever loses its DATE_FORMAT, fall back to
    // "yesterday" rather than shipping a date that is silently off by one.
    poolQuery.mockResolvedValue([[{ business_day: new Date('2026-09-22T00:00:00Z') }]]);
    await expect(resolvePriorBusinessDay(new Date(2026, 8, 23, 5, 20))).resolves.toBe('2026-09-22');
  });

  it('falls back to yesterday when the dimension has no row', async () => {
    poolQuery.mockResolvedValue([[]]);
    // 23 Sep 2026 local -> 22 Sep. Constructed with local parts so the
    // expectation does not depend on the machine's zone.
    await expect(resolvePriorBusinessDay(new Date(2026, 8, 23, 5, 20))).resolves.toBe('2026-09-22');
  });

  it('falls back across a month boundary', async () => {
    poolQuery.mockResolvedValue([[]]);
    await expect(resolvePriorBusinessDay(new Date(2026, 9, 1, 0, 30))).resolves.toBe('2026-09-30');
  });
});
