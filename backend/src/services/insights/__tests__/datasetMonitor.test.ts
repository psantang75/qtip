/**
 * Unit tests for the dataset-health evaluator.
 *
 * Covers the anomaly math directly (median, weekday baseline WARN/RED
 * thresholds, zero/min floors) and drives evaluateDataset with a queued pool
 * mock for the two strategies: run_recency (staleness + volume drop, hard
 * failure) and daily_fact (per-day weekday baseline drop). pool + the heavy AA
 * service (for businessNow) + logger are mocked so this runs without a DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queue: unknown[][] = [];

vi.mock('../../../config/database', () => ({
  default: { query: vi.fn(() => Promise.resolve([queue.shift() ?? [], []])) },
}));

vi.mock('../../insightsAgentActivity.service', () => ({
  // Fixed ET clock: Tue 2026-08-25 14:00 ET. Weekday is derived from the plain
  // date string, so every mocked run lands on the same business weekday.
  businessNow: () => ({ date: '2026-08-25', hour: 14 }),
}));

vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { evaluateDataset, median, classifyVolume, type DatasetMonitorConfig } from '../datasetMonitor';

const cfg = (o: Partial<DatasetMonitorConfig> = {}): DatasetMonitorConfig => ({
  datasetCode: 'x', displayName: 'X', producerKind: 'source_report', producerRef: 'source-x',
  checkKind: 'run_recency', factTable: null, dateColumn: null, dateKind: null,
  expectedByHour: 10, cadenceMinutes: 60, arrearsDays: 0, businessDaysOnly: false,
  baselineLookbackDays: 56, warnPct: 50, redPct: 15, minExpectedRows: 0, zeroIsRed: false,
  ...o,
});

beforeEach(() => {
  queue.length = 0;
  vi.clearAllMocks();
});

describe('median', () => {
  it('handles empty, odd, and even lengths', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3); // round((2+3)/2)
  });
});

describe('classifyVolume', () => {
  it('is OK at/above the warn threshold', () => {
    expect(classifyVolume(cfg(), 100, 100).status).toBe('OK');
    expect(classifyVolume(cfg(), 60, 100).status).toBe('OK');
  });
  it('WARNs below warn_pct and REDs below red_pct', () => {
    expect(classifyVolume(cfg(), 40, 100).status).toBe('WARN');
    expect(classifyVolume(cfg(), 10, 100).status).toBe('RED');
  });
  it('treats zero against a baseline as WARN, or RED when zero_is_red', () => {
    expect(classifyVolume(cfg(), 0, 100).status).toBe('WARN');
    expect(classifyVolume(cfg({ zeroIsRed: true }), 0, 100).status).toBe('RED');
  });
  it('applies the min_expected_rows floor with no baseline', () => {
    expect(classifyVolume(cfg({ minExpectedRows: 5 }), 2, 0).status).toBe('WARN');
    expect(classifyVolume(cfg({ minExpectedRows: 5 }), 10, 0).status).toBe('OK');
  });
});

describe('evaluateDataset — run_recency', () => {
  it('WARNs when the latest successful run drops below the weekday baseline', async () => {
    queue.push([{ run_finished_at: new Date('2026-08-25T17:00:00Z') }]); // lastSuccessAt display
    queue.push([
      { status: 'SUCCESS', run_finished_at: new Date('2026-08-25T17:00:00Z'), rows_loaded: 20, error_message: null },
      { status: 'SUCCESS', run_finished_at: new Date('2026-08-19T17:00:00Z'), rows_loaded: 100, error_message: null },
      { status: 'SUCCESS', run_finished_at: new Date('2026-08-12T17:00:00Z'), rows_loaded: 100, error_message: null },
      { status: 'SUCCESS', run_finished_at: new Date('2026-08-05T17:00:00Z'), rows_loaded: 100, error_message: null },
    ]);

    const h = await evaluateDataset(cfg(), new Date('2026-08-25T18:00:00Z'));
    expect(h.status).toBe('WARN');
    expect(h.lastRowCount).toBe(20);
    expect(h.baselineCount).toBe(100);
  });

  it('REDs when the last success is older than the staleness allowance', async () => {
    queue.push([{ run_finished_at: new Date('2026-08-25T10:00:00Z') }]);
    queue.push([
      { status: 'SUCCESS', run_finished_at: new Date('2026-08-25T10:00:00Z'), rows_loaded: 100, error_message: null },
    ]);

    const h = await evaluateDataset(cfg(), new Date('2026-08-25T18:00:00Z'));
    expect(h.status).toBe('RED');
    expect(h.reason).toMatch(/stale/i);
  });

  it('REDs when the most recent run failed', async () => {
    queue.push([{ run_finished_at: new Date('2026-08-25T10:00:00Z') }]);
    queue.push([
      { status: 'FAILED', run_finished_at: new Date('2026-08-25T17:30:00Z'), rows_loaded: null, error_message: 'boom' },
    ]);

    const h = await evaluateDataset(cfg(), new Date('2026-08-25T18:00:00Z'));
    expect(h.status).toBe('RED');
    expect(h.reason).toMatch(/failed/i);
  });
});

describe('evaluateDataset — daily_fact', () => {
  it('WARNs when the latest present day is below the same-weekday baseline', async () => {
    const c = cfg({ checkKind: 'daily_fact', factTable: 'ie_fact_call', dateColumn: 'date_key', dateKind: 'date_key' });
    queue.push([{ run_finished_at: new Date('2026-08-25T13:00:00Z') }]); // lastSuccessAt display
    queue.push([
      { dk: '20260825', c: 20 },
      { dk: '20260818', c: 100 },
      { dk: '20260811', c: 100 },
      { dk: '20260804', c: 100 },
    ]);

    const h = await evaluateDataset(c, new Date('2026-08-25T18:00:00Z'));
    expect(h.status).toBe('WARN');
    expect(h.lastRowCount).toBe(20);
    expect(h.baselineCount).toBe(100);
  });
});
