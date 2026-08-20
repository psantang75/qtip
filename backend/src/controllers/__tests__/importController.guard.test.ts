/**
 * Guard tests for the manual Import Center allowlist (docs/database_review.md
 * §1D mitigation). The upload/preview handlers must refuse any data_type that
 * isn't in the ingestion allowlist BEFORE running an import, so a hand-uploaded
 * non-punch report can't inject duplicate rows into the `*_raw` Data Explorer
 * tables. With no `IMPORT_ALLOWED_TYPES` env set the allowlist defaults to
 * `punch_data` only.
 *
 * prisma is mocked; runImport/previewImport are mocked (isDataType and the
 * allowlist resolver are kept real). environment is intentionally NOT mocked so
 * the real config/logger stay intact and the default allowlist applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => ({
  default: { importLog: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock('../../services/imports/runImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/imports/runImport')>();
  return { ...actual, runImport: vi.fn(async () => ({ import_log_id: 1, rows_total: 0, rows_imported: 0, rows_skipped: 0, rows_errored: 0, warnings: [] })) };
});

vi.mock('../../services/importService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/importService')>();
  return { ...actual, previewImport: vi.fn(async () => ({ ok: true })) };
});

import { uploadImport, previewImportHandler } from '../importController';
import { runImport } from '../../services/imports/runImport';
import { previewImport } from '../../services/importService';

const runImportMock = runImport as unknown as ReturnType<typeof vi.fn>;
const previewImportMock = previewImport as unknown as ReturnType<typeof vi.fn>;

function mockRes() {
  const res: { statusCode: number; body: unknown; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    statusCode: 0,
    body: undefined,
    status: vi.fn((code: number) => { res.statusCode = code; return res; }),
    json: vi.fn((payload: unknown) => { res.body = payload; return res; }),
  };
  return res;
}

const fakeFile = { buffer: Buffer.from('x'), originalname: 'report.xlsx' };

beforeEach(() => {
  runImportMock.mockClear();
  previewImportMock.mockClear();
});

describe('manual Import Center allowlist guard', () => {
  it('rejects a disallowed (non-punch) type on upload without importing', async () => {
    const res = mockRes();
    const req = { file: fakeFile, body: { data_type: 'ticket_task' }, user: { user_id: 7 } };
    await uploadImport(req as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(String((res.body as { message: string }).message)).toContain('disabled');
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it('rejects a disallowed type on preview without parsing', async () => {
    const res = mockRes();
    const req = { file: fakeFile, body: { data_type: 'sales_margin' } };
    await previewImportHandler(req as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(previewImportMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid/missing data_type with the format message', async () => {
    const res = mockRes();
    const req = { file: fakeFile, body: {}, user: { user_id: 7 } };
    await uploadImport(req as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(String((res.body as { message: string }).message)).toContain('Must be one of');
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it('allows the default punch_data type through to the importer', async () => {
    const res = mockRes();
    const req = { file: fakeFile, body: { data_type: 'punch_data' }, user: { user_id: 7 } };
    await uploadImport(req as never, res as never);
    expect(runImportMock).toHaveBeenCalledTimes(1);
    expect(runImportMock).toHaveBeenCalledWith('punch_data', fakeFile.buffer, 'report.xlsx', 7);
    expect(res.statusCode).toBe(200);
  });
});
