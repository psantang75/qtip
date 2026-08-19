/**
 * Controller/HTTP-layer tests for the unified Ingestion Log controller.
 *
 * Guards the Prisma migration of the SQL-pipeline feed (`ie_ingestion_log`):
 * the `UnifiedIngestionRow` contract the Ingestion Log UI depends on
 * (`ie-<id>` id prefix, ISO dates, passthrough status/row counts), plus the
 * cross-cutting query behaviour the endpoint owns — the `status` filter, the
 * newest-first sort, and the `limit` clamp/slice. The Excel-import
 * (`import_logs`) branch is exercised by the `importLogView` unit tests; here
 * we drive the SQL channel so the mapping we migrated is covered directly.
 * Prisma is mocked, so these run without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    ieIngestionLog: { findMany: vi.fn() },
    importLog: { findMany: vi.fn() },
  };
  return { default: db };
});

import prisma from '../../config/prisma';
import { getIngestionLog } from '../insightsAdminIngestion.controller';

const db = prisma as unknown as {
  ieIngestionLog: { findMany: ReturnType<typeof vi.fn> };
  importLog: { findMany: ReturnType<typeof vi.fn> };
};

function mockRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((c: number) => {
      res.statusCode = c;
      return res;
    }),
    json: vi.fn((b: unknown) => {
      res.body = b;
      return res;
    }),
  };
  return res;
}

function ieRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    worker_name: 'LeadSourceSync',
    source_system: 'crm',
    run_started_at: new Date('2026-02-01T10:00:00.000Z'),
    run_finished_at: new Date('2026-02-01T10:05:00.000Z'),
    status: 'SUCCESS',
    rows_loaded: 100,
    rows_skipped: 2,
    rows_errored: 0,
    error_message: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getIngestionLog (SQL channel)', () => {
  it('maps ie_ingestion_log rows to the unified shape and skips import_logs', async () => {
    db.ieIngestionLog.findMany.mockResolvedValue([ieRow()]);
    const res = mockRes();
    const next = vi.fn();

    await getIngestionLog({ query: { channel: 'sql' } } as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    // Excel-import path must not run for the sql-only channel.
    expect(db.importLog.findMany).not.toHaveBeenCalled();
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0]).toEqual({
      id: 'ie-1',
      channel: 'sql',
      name: 'LeadSourceSync',
      source: 'crm',
      started: '2026-02-01T10:00:00.000Z',
      finished: '2026-02-01T10:05:00.000Z',
      status: 'SUCCESS',
      rows_loaded: 100,
      rows_skipped: 2,
      rows_errored: 0,
      error_message: null,
    });
  });

  it('passes a worker filter through to Prisma and tolerates a null finish time', async () => {
    db.ieIngestionLog.findMany.mockResolvedValue([
      ieRow({ id: 7, run_finished_at: null, status: 'RUNNING' }),
    ]);
    const res = mockRes();
    const next = vi.fn();

    await getIngestionLog({ query: { channel: 'sql', worker: 'LeadSourceSync' } } as never, res as never, next);

    expect(db.ieIngestionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { worker_name: 'LeadSourceSync' } }),
    );
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0].id).toBe('ie-7');
    expect(body[0].finished).toBeNull();
    expect(body[0].status).toBe('RUNNING');
  });

  it('filters by status when one is supplied', async () => {
    db.ieIngestionLog.findMany.mockResolvedValue([
      ieRow({ id: 1, status: 'SUCCESS', run_started_at: new Date('2026-02-01T10:00:00.000Z') }),
      ieRow({ id: 2, status: 'FAILED', run_started_at: new Date('2026-02-02T10:00:00.000Z') }),
    ]);
    const res = mockRes();
    const next = vi.fn();

    await getIngestionLog({ query: { channel: 'sql', status: 'FAILED' } } as never, res as never, next);

    const body = res.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('ie-2');
  });

  it('sorts newest-first and clamps to the requested limit', async () => {
    db.ieIngestionLog.findMany.mockResolvedValue([
      ieRow({ id: 1, run_started_at: new Date('2026-02-01T00:00:00.000Z') }),
      ieRow({ id: 2, run_started_at: new Date('2026-02-03T00:00:00.000Z') }),
      ieRow({ id: 3, run_started_at: new Date('2026-02-02T00:00:00.000Z') }),
    ]);
    const res = mockRes();
    const next = vi.fn();

    await getIngestionLog({ query: { channel: 'sql', limit: '2' } } as never, res as never, next);

    const body = res.body as Array<Record<string, unknown>>;
    // Sorted by started DESC, then sliced to the limit.
    expect(body.map((r) => r.id)).toEqual(['ie-2', 'ie-3']);
  });
});
