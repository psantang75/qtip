import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceReportConfig } from '../SourceReportSyncWorker';

const { sqlRun, sqlCtor, deskRun, deskCtor, isConfigured } = vi.hoisted(() => {
  const sqlRun = vi.fn();
  const deskRun = vi.fn();
  return {
    sqlRun,
    deskRun,
    sqlCtor: vi.fn(function (this: { run: typeof sqlRun }) { this.run = sqlRun; }),
    deskCtor: vi.fn(function (this: { run: typeof deskRun }) { this.run = deskRun; }),
    isConfigured: vi.fn(),
  };
});

vi.mock('../SourceReportSyncWorker', () => ({ SourceReportSyncWorker: sqlCtor }));
vi.mock('../DeskTimeSyncWorker', () => ({ DeskTimeSyncWorker: deskCtor }));
vi.mock('../../services/desktime/DeskTimeService', () => ({ deskTimeService: { isConfigured } }));
vi.mock('../../services/insightsAgentActivity.service', () => ({
  businessNow: (d: Date) => ({ date: d.toISOString().slice(0, 10), hour: 0 }),
}));

import { isApiSourceReport, recentBusinessDays, runSourceReport } from '../apiSourceReports';

const cfg = (report_code: string, incremental_days = 2) => ({ report_code, incremental_days }) as SourceReportConfig;

describe('apiSourceReports', () => {
  beforeEach(() => { vi.clearAllMocks(); isConfigured.mockReturnValue(true); });

  it('recognises only registered API reports', () => {
    expect(isApiSourceReport('desktime_daily')).toBe(true);
    expect(isApiSourceReport('call_activity')).toBe(false);
  });

  it('runs SQL reports through SourceReportSyncWorker unchanged', async () => {
    sqlRun.mockResolvedValue({ rowsLoaded: 1 });
    const c = cfg('call_activity');
    await runSourceReport(c);
    expect(sqlCtor).toHaveBeenCalledWith(c);
    expect(deskCtor).not.toHaveBeenCalled();
  });

  it('runs desktime_daily as day requests for the last incremental_days ET days', async () => {
    deskRun.mockResolvedValue({ rowsLoaded: 5 });
    vi.useFakeTimers().setSystemTime(new Date('2026-09-24T15:00:00Z'));
    try {
      await runSourceReport(cfg('desktime_daily', 3));
    } finally {
      vi.useRealTimers();
    }
    expect(sqlCtor).not.toHaveBeenCalled();
    expect(deskCtor).toHaveBeenCalledWith([
      { date: '2026-09-22', period: 'day' },
      { date: '2026-09-23', period: 'day' },
      { date: '2026-09-24', period: 'day' },
    ]);
  });

  it('fails the run (so the schedule shows FAILED) when DeskTime is not configured', async () => {
    isConfigured.mockReturnValue(false);
    await expect(runSourceReport(cfg('desktime_daily'))).rejects.toThrow('DESKTIME_API_KEY');
    expect(deskCtor).not.toHaveBeenCalled();
  });

  it('always pulls at least today', () => {
    expect(recentBusinessDays(0, new Date('2026-09-24T15:00:00Z'))).toEqual(['2026-09-24']);
  });
});
