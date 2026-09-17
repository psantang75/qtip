/**
 * Cycle Performance's five facts load as one pipeline. These tests lock the
 * two rules that made the page's numbers depend on the operator: the order,
 * and that a failure stops the rest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query, execute, getConnection, workerRun, MockWorker } = vi.hoisted(() => {
  const workerRun = vi.fn();
  class MockWorker {
    cfg: { report_code: string };
    constructor(cfg: { report_code: string }) { this.cfg = cfg; }
    run() { return workerRun(); }
  }
  return {
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
    workerRun,
    MockWorker,
  };
});

vi.mock('../../../../config/database', () => ({
  default: {
    query: (...args: unknown[]) => query(...args),
    execute: (...args: unknown[]) => execute(...args),
    getConnection: (...args: unknown[]) => getConnection(...args),
  },
}));

vi.mock('../../../../workers/SourceReportSyncWorker', () => ({
  SourceReportSyncWorker: MockWorker,
}));

vi.mock('../../../../config/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../notifications/ingestionAlerts', () => ({
  notifyIngestionFailure: vi.fn(),
}));

import {
  CYCLE_LOAD_ORDER, isCyclePipelineCode, splitCycleDue, runCyclePipeline,
} from '../cyclePipeline';

function cfg(code: string, id: number) {
  return {
    id, report_code: code, report_name: code, source_pool: 'crm',
    extract_sql_file: `${code}.extract.sql`, transform_sql_file: `${code}.transform.sql`,
    staging_table: `ie_stg_${code}`, target_fact_table: `ie_fact_${code}`,
    load_mode: 'FULL_RELOAD_WINDOW', window_months: 15, incremental_days: 45,
  };
}

function lockConn(held = false) {
  return {
    execute: vi.fn().mockResolvedValue([held ? [{ expires_at: new Date(Date.now() + 60_000) }] : []]),
    release: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getConnection.mockResolvedValue(lockConn());
  execute.mockResolvedValue([{ affectedRows: 1 }]);
  query.mockResolvedValue([CYCLE_LOAD_ORDER.map((c, i) => cfg(c, i + 1))]);
  workerRun.mockResolvedValue({ rowsExtracted: 1, rowsLoaded: 1, rowsSkipped: 0, rowsErrored: 0 });
});

describe('splitCycleDue', () => {
  it('collapses any cycle member into one pipeline run', () => {
    const due = [
      { report_code: 'call_activity' },
      { report_code: 'collections_invoice' },
      { report_code: 'lead' },
    ];
    expect(splitCycleDue(due)).toEqual({
      runCycle: true,
      rest: [{ report_code: 'call_activity' }, { report_code: 'lead' }],
    });
  });

  it('leaves a due set with no cycle member alone', () => {
    expect(splitCycleDue([{ report_code: 'lead' }])).toEqual({
      runCycle: false,
      rest: [{ report_code: 'lead' }],
    });
  });
});

describe('isCyclePipelineCode', () => {
  it('does not pull the other collections facts into the page load', () => {
    expect(isCyclePipelineCode('collections_call')).toBe(false);
    expect(isCyclePipelineCode('collections_subscription')).toBe(false);
    expect(CYCLE_LOAD_ORDER).toEqual([
      'collections_task', 'collections_invoice', 'collections_billing',
      'collections_touch', 'collections_recovery',
    ]);
  });
});

describe('runCyclePipeline', () => {
  it('runs the five facts in load order, never in parallel', async () => {
    const result = await runCyclePipeline();

    expect(result.status).toBe('SUCCESS');
    expect(result.steps.map((s) => s.code)).toEqual([...CYCLE_LOAD_ORDER]);
    expect(result.steps.map((s) => s.status)).toEqual(Array(5).fill('SUCCESS'));
    expect(workerRun).toHaveBeenCalledTimes(5);
  });

  it('stops on the first failure so a later fact cannot rebuild on a broken predecessor', async () => {
    let n = 0;
    workerRun.mockImplementation(async () => {
      n += 1;
      if (n === 2) throw new Error('CRM timeout');
      return { rowsExtracted: 1, rowsLoaded: 1 };
    });

    const result = await runCyclePipeline();

    expect(result.status).toBe('FAILED');
    expect(result.steps).toEqual([
      { code: 'collections_task', status: 'SUCCESS' },
      { code: 'collections_invoice', status: 'FAILED', error: 'CRM timeout' },
      { code: 'collections_billing', status: 'SKIPPED' },
      { code: 'collections_touch', status: 'SKIPPED' },
      { code: 'collections_recovery', status: 'SKIPPED' },
    ]);
    expect(workerRun).toHaveBeenCalledTimes(2);
  });

  it('refuses to start a second pipeline while one is already loading', async () => {
    getConnection.mockResolvedValue(lockConn(true));

    const result = await runCyclePipeline();

    expect(result).toEqual({ status: 'BUSY', steps: [] });
    expect(workerRun).not.toHaveBeenCalled();
  });

  it('fails closed when a registry row is missing rather than loading a partial set', async () => {
    query.mockResolvedValue([CYCLE_LOAD_ORDER.slice(0, 4).map((c, i) => cfg(c, i + 1))]);

    const result = await runCyclePipeline();

    expect(result.status).toBe('FAILED');
    expect(workerRun).not.toHaveBeenCalled();
  });
});
