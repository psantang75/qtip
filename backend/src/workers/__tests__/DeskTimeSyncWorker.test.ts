import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResult } from '../BaseInsightsWorker';

const { poolQuery, getEmployeeDays } = vi.hoisted(() => ({ poolQuery: vi.fn(), getEmployeeDays: vi.fn() }));

vi.mock('../../config/database', () => ({ default: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock('../../config/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/notifications/ingestionAlerts', () => ({ notifyIngestionFailure: vi.fn(async () => {}) }));
vi.mock('../../services/desktime/DeskTimeService', () => ({ deskTimeService: { getEmployeeDays } }));

import { DeskTimeSyncWorker, monthRequests } from '../DeskTimeSyncWorker';

const rec = (date: string, employeeId: number, email: string, productiveSec: number) => ({
  date, employeeId, email, name: null, group: null, arrivedAt: null, leftAt: null, isLate: false,
  onlineSec: 0, desktimeSec: 0, atWorkSec: 0, productiveSec, productivityPct: null, efficiencyPct: null,
});

const execute = (w: DeskTimeSyncWorker) => (w as unknown as { execute(): Promise<WorkerResult> }).execute();

describe('monthRequests', () => {
  it('emits one month request per calendar month, anchored on the 1st, across a year boundary', () => {
    expect(monthRequests('2025-11-15', '2026-02-03')).toEqual([
      { date: '2025-11-01', period: 'month' },
      { date: '2025-12-01', period: 'month' },
      { date: '2026-01-01', period: 'month' },
      { date: '2026-02-01', period: 'month' },
    ]);
  });

  it('emits a single request for a range inside one month', () => {
    expect(monthRequests('2026-03-02', '2026-03-31')).toEqual([{ date: '2026-03-01', period: 'month' }]);
  });
});

describe('DeskTimeSyncWorker', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    getEmployeeDays.mockReset();
    poolQuery.mockImplementation(async (sql: string) =>
      sql.includes('ie_dim_employee') ? [[{ email: 'a@x.com', employeeKey: 42 }]] : [{ affectedRows: 1 }]);
  });

  it('upserts each record with its date_key and mapped employee_key', async () => {
    getEmployeeDays.mockResolvedValue([rec('2026-09-09', 7, 'a@x.com', 600), rec('2026-09-09', 8, 'b@x.com', 0)]);
    const res = await execute(new DeskTimeSyncWorker([{ date: '2026-09-09', period: 'day' }]));

    expect(res).toMatchObject({ rowsExtracted: 2, rowsLoaded: 2, rowsSkipped: 0 });
    const [sql, [values]] = poolQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO ie_fact_desktime_daily'))!;
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(values[0].slice(0, 4)).toEqual([20260909, 7, 42, 'a@x.com']);
    expect(values[0][12]).toBe(600);
    expect(values[1][2]).toBeNull();
  });

  it('drops month rows outside the backfill range', async () => {
    getEmployeeDays.mockResolvedValue([
      rec('2026-03-01', 7, 'a@x.com', 1), rec('2026-03-02', 7, 'a@x.com', 2), rec('2026-03-31', 7, 'a@x.com', 3),
    ]);
    const res = await execute(new DeskTimeSyncWorker(monthRequests('2026-03-02', '2026-03-30'), { from: '2026-03-02', to: '2026-03-30' }));

    expect(getEmployeeDays).toHaveBeenCalledWith('2026-03-01', 'month');
    expect(res).toMatchObject({ rowsExtracted: 3, rowsLoaded: 1, rowsSkipped: 2, batchIdentifier: '2026-03-02..2026-03-30' });
  });

  it('writes nothing when DeskTime returns no records', async () => {
    getEmployeeDays.mockResolvedValue([]);
    const res = await execute(new DeskTimeSyncWorker([{ date: '2026-09-13', period: 'day' }]));
    expect(res.rowsLoaded).toBe(0);
    expect(poolQuery.mock.calls.some(([s]) => String(s).includes('INSERT'))).toBe(false);
  });
});
