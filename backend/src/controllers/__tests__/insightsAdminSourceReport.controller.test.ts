/**
 * Controller/HTTP-layer tests for the Insights Admin Source Report controller.
 *
 * Guards the Prisma migration (via the `IeSourceReport` model): the `mapRow`
 * response contract the source-reports admin UI depends on (ISO dates, null
 * normalization, scheduling-only fields), the scheduling-field validation
 * (frequency >= 5, run_only_hours range, "no editable fields"), and the
 * AppError envelope (400 invalid id/validation, 404 missing report incl. the
 * Prisma P2025 → 404 mapping). Prisma + the sync worker + ingestion alerts are
 * mocked, so these run without a database or background work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    ieSourceReport: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { default: db };
});

vi.mock('../../workers/SourceReportSyncWorker', () => ({
  SourceReportSyncWorker: vi.fn(),
}));

vi.mock('../../services/notifications/ingestionAlerts', () => ({
  notifyIngestionFailure: vi.fn(),
}));

import prisma from '../../config/prisma';
import {
  listSourceReportsAdmin,
  updateSourceReport,
  runSourceReportNow,
} from '../insightsAdminSourceReport.controller';

const db = prisma as unknown as {
  ieSourceReport: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
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

/** A full registry row so `mapRow` can read every field it maps. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    report_code: 'lead_sources',
    report_name: 'Lead Sources',
    source_pool: 'crm',
    extract_sql_file: 'extract.sql',
    transform_sql_file: null,
    staging_table: 'stg_lead_sources',
    target_fact_table: 'fact_lead_sources',
    load_mode: 'INCREMENTAL_WINDOW',
    window_months: 24,
    incremental_days: 14,
    frequency_minutes: 60,
    run_only_hours: null,
    is_active: true,
    last_run_at: new Date('2026-02-01T10:00:00.000Z'),
    next_run_at: null,
    last_status: 'SUCCESS',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listSourceReportsAdmin', () => {
  it('maps rows to the scheduling-only shape with ISO dates and null normalization', async () => {
    db.ieSourceReport.findMany.mockResolvedValue([makeRow()]);
    const res = mockRes();
    const next = vi.fn();

    await listSourceReportsAdmin({} as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0]).toEqual({
      id: 1,
      report_code: 'lead_sources',
      report_name: 'Lead Sources',
      source_pool: 'crm',
      load_mode: 'INCREMENTAL_WINDOW',
      window_months: 24,
      incremental_days: 14,
      frequency_minutes: 60,
      run_only_hours: null,
      is_active: true,
      target_fact_table: 'fact_lead_sources',
      last_run_at: '2026-02-01T10:00:00.000Z',
      next_run_at: null,
      last_status: 'SUCCESS',
    });
    // Structural fields must never leak to the admin UI.
    expect(body[0]).not.toHaveProperty('extract_sql_file');
    expect(body[0]).not.toHaveProperty('staging_table');
  });
});

describe('updateSourceReport', () => {
  it('rejects a non-numeric id with a 400 AppError via next()', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updateSourceReport({ params: { id: 'abc' }, body: { is_active: true } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(400);
    expect(db.ieSourceReport.update).not.toHaveBeenCalled();
  });

  it('rejects frequency_minutes below 5 with a 400', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updateSourceReport({ params: { id: '1' }, body: { frequency_minutes: 3 } } as never, res as never, next);

    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(400);
    expect(db.ieSourceReport.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed run_only_hours with a 400', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updateSourceReport({ params: { id: '1' }, body: { run_only_hours: 'noon-ish' } } as never, res as never, next);

    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(400);
  });

  it('rejects an empty edit set with a 400', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updateSourceReport({ params: { id: '1' }, body: {} } as never, res as never, next);

    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(400);
    expect(db.ieSourceReport.update).not.toHaveBeenCalled();
  });

  it('updates only the supplied scheduling fields and returns the mapped row', async () => {
    db.ieSourceReport.update.mockResolvedValue(makeRow({ is_active: false, run_only_hours: '2-5' }));
    const res = mockRes();
    const next = vi.fn();

    await updateSourceReport(
      { params: { id: '1' }, body: { is_active: false, run_only_hours: '2 - 5' } } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(db.ieSourceReport.update).toHaveBeenCalledWith({
      where: { id: 1 },
      // run_only_hours whitespace is stripped to the canonical '2-5'.
      data: { is_active: false, run_only_hours: '2-5' },
    });
    expect((res.body as { is_active: boolean }).is_active).toBe(false);
    expect((res.body as { run_only_hours: string }).run_only_hours).toBe('2-5');
  });

  it('maps a Prisma P2025 (record not found) to a 404 AppError via next()', async () => {
    const notFound = Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
    db.ieSourceReport.update.mockRejectedValue(notFound);
    const res = mockRes();
    const next = vi.fn();

    await updateSourceReport({ params: { id: '999' }, body: { is_active: true } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(404);
  });
});

describe('runSourceReportNow', () => {
  it('returns a 404 AppError via next() when the report does not exist', async () => {
    db.ieSourceReport.findUnique.mockResolvedValue(null);
    const res = mockRes();
    const next = vi.fn();

    await runSourceReportNow({ params: { id: '5' } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(404);
    expect(db.ieSourceReport.update).not.toHaveBeenCalled();
  });
});
