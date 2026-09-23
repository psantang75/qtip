/**
 * Cover for the due rule that replaced the `ie-missed-opportunities` PM2 cron.
 * Driven through the real timer path so the arm/re-arm wiring is exercised too,
 * not just the decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.fn();
const getRunStatus = vi.fn();
const resolvePriorBusinessDay = vi.fn();
const workerCtor = vi.fn();
const workerRun = vi.fn();

vi.mock('../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/insights/missedOpportunities/settings', () => ({
  getMissedOpportunitySettings: () => getSettings(),
}));

vi.mock('../../services/insights/missedOpportunities/reportSupport', () => ({
  getRunStatus: (...a: unknown[]) => getRunStatus(...a),
}));

vi.mock('../../services/insights/missedOpportunities/workerSupport', () => ({
  resolvePriorBusinessDay: () => resolvePriorBusinessDay(),
}));

vi.mock('../MissedOpportunitiesWorker', () => ({
  MissedOpportunitiesWorker: class {
    constructor(runDate?: string) {
      workerCtor(runDate);
    }
    run() {
      return workerRun();
    }
  },
}));

import {
  startMissedOpportunitiesScheduler,
  stopMissedOpportunitiesScheduler,
} from '../missedOpportunitiesScheduler';

/** Past the 90s boot delay, into the first real tick. */
const PAST_BOOT_MS = 91_000;
const TICK_MS = 15 * 60_000;

/** Local-time constructor so the assertions don't depend on the machine's zone. */
const at = (hour: number): Date => new Date(2026, 8, 23, hour, 30);

beforeEach(() => {
  vi.useFakeTimers();
  getSettings.mockReset().mockResolvedValue({ scheduleEnabled: true, scheduleHour: 5 });
  getRunStatus.mockReset().mockResolvedValue(null);
  resolvePriorBusinessDay.mockReset().mockResolvedValue('2026-09-22');
  workerCtor.mockReset();
  workerRun.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  stopMissedOpportunitiesScheduler();
  vi.useRealTimers();
});

describe('missedOpportunitiesScheduler', () => {
  it('grades the prior business day once the configured hour has passed', async () => {
    vi.setSystemTime(at(5));
    await startMissedOpportunitiesScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerCtor).toHaveBeenCalledWith('2026-09-22');
    expect(workerRun).toHaveBeenCalledTimes(1);
  });

  it('does nothing before the configured hour', async () => {
    vi.setSystemTime(at(4));
    await startMissedOpportunitiesScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).not.toHaveBeenCalled();
  });

  it('does nothing when the schedule is switched off', async () => {
    vi.setSystemTime(at(9));
    getSettings.mockResolvedValue({ scheduleEnabled: false, scheduleHour: 5 });
    await startMissedOpportunitiesScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).not.toHaveBeenCalled();
  });

  it('never grades a day twice, and does not auto-retry a failure', async () => {
    vi.setSystemTime(at(9));
    for (const status of ['SUCCESS', 'RUNNING', 'PARTIAL', 'FAILED'] as const) {
      getRunStatus.mockResolvedValue({ status });
      await startMissedOpportunitiesScheduler();
      await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);
      stopMissedOpportunitiesScheduler();
      expect(workerRun, `status ${status} should be left alone`).not.toHaveBeenCalled();
    }
  });

  it('keeps ticking after a failed tick', async () => {
    vi.setSystemTime(at(9));
    // First call is the boot summary; the second is the first tick, which fails.
    getSettings
      .mockResolvedValueOnce({ scheduleEnabled: true, scheduleHour: 5 })
      .mockRejectedValueOnce(new Error('db blip'));
    await startMissedOpportunitiesScheduler();

    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);
    expect(workerRun).not.toHaveBeenCalled();

    // The next tick re-reads settings and proceeds, so one bad read does not
    // end the schedule for the life of the process.
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(workerRun).toHaveBeenCalledTimes(1);
  });

  it('picks the day up on a later tick when the window opens mid-run', async () => {
    vi.setSystemTime(at(4));
    await startMissedOpportunitiesScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);
    expect(workerRun).not.toHaveBeenCalled();

    vi.setSystemTime(at(5));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(workerRun).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second start does not double-arm', async () => {
    vi.setSystemTime(at(9));
    await startMissedOpportunitiesScheduler();
    await startMissedOpportunitiesScheduler();
    await vi.advanceTimersByTimeAsync(PAST_BOOT_MS);

    expect(workerRun).toHaveBeenCalledTimes(1);
  });
});
