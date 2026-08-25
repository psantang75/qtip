/**
 * Controller tests for the Admin Monitoring endpoints. Prisma is mocked so these
 * run without a DB. Covers the health merge (monitor left-joined onto health,
 * with an UNKNOWN fallback for datasets not yet evaluated) and the registry PUT
 * validation (Zod field checks + the red_pct <= warn_pct invariant).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    ieDatasetMonitor: { findMany: vi.fn(), update: vi.fn() },
    ieDatasetHealth: { findMany: vi.fn() },
  };
  return { default: db };
});

vi.mock('../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import prisma from '../../config/prisma';
import { getMonitoringHealth, updateDatasetMonitor } from '../insightsAdminMonitoring.controller';

const db = prisma as unknown as {
  ieDatasetMonitor: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  ieDatasetHealth: { findMany: ReturnType<typeof vi.fn> };
};

function mockRes() {
  const res: {
    statusCode: number; body: unknown;
    status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>;
  } = {
    statusCode: 200, body: undefined,
    status: vi.fn((c: number) => { res.statusCode = c; return res; }),
    json: vi.fn((b: unknown) => { res.body = b; return res; }),
  };
  return res;
}

function monitorRow(o: Record<string, unknown> = {}) {
  return {
    id: 1, dataset_code: 'call_activity', display_name: 'Call Activity',
    producer_kind: 'source_report', producer_ref: 'source-call_activity', check_kind: 'daily_fact',
    fact_table: 'ie_fact_call_activity', expected_by_hour: 10, cadence_minutes: 60, arrears_days: 0,
    business_days_only: true, baseline_lookback_days: 56, warn_pct: 50, red_pct: 15,
    min_expected_rows: 0, zero_is_red: false, is_active: true, ...o,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('getMonitoringHealth', () => {
  it('merges health onto the monitor registry and falls back to UNKNOWN', async () => {
    db.ieDatasetMonitor.findMany.mockResolvedValue([
      monitorRow(),
      monitorRow({ id: 2, dataset_code: 'lead', display_name: 'Leads' }),
    ]);
    db.ieDatasetHealth.findMany.mockResolvedValue([
      {
        dataset_code: 'call_activity', status: 'WARN', reason: 'low volume',
        last_success_at: new Date('2026-08-25T13:00:00.000Z'),
        expected_by: new Date('2026-08-25T14:00:00.000Z'),
        last_row_count: 20, baseline_count: 100,
        status_since: new Date('2026-08-25T13:30:00.000Z'),
        evaluated_at: new Date('2026-08-25T13:55:00.000Z'),
      },
    ]);
    const res = mockRes();

    await getMonitoringHealth({} as never, res as never, vi.fn());

    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ datasetCode: 'call_activity', status: 'WARN', lastRowCount: 20, baselineCount: 100 });
    expect(body[0].lastSuccessAt).toBe('2026-08-25T13:00:00.000Z');
    // No health row for 'lead' -> UNKNOWN pending.
    expect(body[1]).toMatchObject({ datasetCode: 'lead', status: 'UNKNOWN', reason: 'not evaluated yet' });
  });
});

describe('updateDatasetMonitor', () => {
  it('rejects red_pct greater than warn_pct with a validation error', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updateDatasetMonitor(
      { params: { id: '1' }, body: { warn_pct: 20, red_pct: 40 } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as { statusCode?: number; message: string };
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/red_pct/);
    expect(db.ieDatasetMonitor.update).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range expected_by_hour', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updateDatasetMonitor(
      { params: { id: '1' }, body: { expected_by_hour: 30 } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(db.ieDatasetMonitor.update).not.toHaveBeenCalled();
  });

  it('updates valid threshold fields and returns the mapped row', async () => {
    db.ieDatasetMonitor.update.mockResolvedValue(monitorRow({ warn_pct: 60, red_pct: 20 }));
    const res = mockRes();
    const next = vi.fn();

    await updateDatasetMonitor(
      { params: { id: '1' }, body: { warn_pct: 60, red_pct: 20 } } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(db.ieDatasetMonitor.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { warn_pct: 60, red_pct: 20 } }),
    );
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({ id: 1, warn_pct: 60, red_pct: 20 });
  });
});
