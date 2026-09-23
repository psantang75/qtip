/**
 * Cover for the monthly due rule that replaced the `ie-sales-plays-miner` PM2
 * cron. The regression that matters most: the cron fired on every container
 * start, so a deploy spent money. "Already mined this month" is what stops that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.fn();
const poolQuery = vi.fn();
const workerRun = vi.fn();

vi.mock('../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/database', () => ({
  default: { query: (...a: unknown[]) => poolQuery(...a) },
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/settings', () => ({
  getSalesPlaysSettings: () => getSettings(),
}));

vi.mock('../SalesPlaysMinerWorker', () => ({
  SalesPlaysMinerWorker: class {
    run() {
      return workerRun();
    }
  },
}));

import { startSalesPlaysScheduler, stopSalesPlaysScheduler } from '../salesPlaysScheduler';

/** Past the 5-minute boot delay, into the first real tick. */
const PAST_BOOT_MS = 5 * 60_000 + 1_000;
const TICK_MS = 60 * 60_000;

/** Local-time constructor so assertions don't depend on the machine's zone. */
const at = (day: number, hour: number): Date => new Date(2026, 9, day, hour, 15);

/** No prior run this month. */
const notMined = () => poolQuery.mockResolvedValue([[]]);
/** A run row already exists this month. */
const alreadyMined = () => poolQuery.mockResolvedValue([[{ 1: 1 }]]);

beforeEach(() => {
  vi.useFakeTimers();
  getSettings.mockReset().mockResolvedValue({ enabled: true, scheduleDay: 1, scheduleHour: 6 });
  poolQuery.mockReset();
  notMined();
  workerRun.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  stopSalesPlaysScheduler();
  vi.useRealTimers();
});

describe('salesPlaysScheduler', () => {
  it('mines on the scheduled day once the hour has passed', async () => {
    vi.setSystemTime(at(1, 6));
    await startSalesPlaysScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).toHaveBeenCalledTimes(1);
  });

  it('does not mine before the scheduled hour on the scheduled day', async () => {
    vi.setSystemTime(at(1, 5));
    await startSalesPlaysScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).not.toHaveBeenCalled();
  });

  it('does not mine again once it has already run this month', async () => {
    // This is the deploy case: mid-month restart, schedule long past.
    vi.setSystemTime(at(23, 16));
    alreadyMined();
    await startSalesPlaysScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).not.toHaveBeenCalled();
  });

  it('still catches up later in the month when the day was missed', async () => {
    vi.setSystemTime(at(23, 16));
    notMined();
    await startSalesPlaysScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).toHaveBeenCalledTimes(1);
  });

  it('scopes the already-mined check to the current calendar month', async () => {
    vi.setSystemTime(at(15, 9));
    await startSalesPlaysScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    const params = poolQuery.mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toBe('SalesPlaysMinerWorker');
    expect(params[1]).toBe('2026-10-01 00:00:00');
  });

  it('does nothing when the learning loop is off, without querying run history', async () => {
    vi.setSystemTime(at(1, 9));
    getSettings.mockResolvedValue({ enabled: false, scheduleDay: 1, scheduleHour: 6 });
    await startSalesPlaysScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('keeps ticking after a failed tick', async () => {
    vi.setSystemTime(at(1, 9));
    getSettings
      .mockResolvedValueOnce({ enabled: true, scheduleDay: 1, scheduleHour: 6 })
      .mockRejectedValueOnce(new Error('db blip'));
    await startSalesPlaysScheduler();

    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);
    expect(workerRun).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(workerRun).toHaveBeenCalledTimes(1);
  });
});
