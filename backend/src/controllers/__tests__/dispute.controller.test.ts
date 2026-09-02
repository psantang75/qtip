/**
 * Controller/HTTP-layer tests for the dispute controller.
 *
 * Guards the error-envelope migration (Phase 2.2): every handler was moved off
 * the legacy `res.status(n).json({ message })` shape onto `asyncHandler` +
 * thrown `AppError` (rendered by the global middleware). These tests drive the
 * validation / not-found / access-denied branches and assert the handler
 * forwards an `AppError` with the SAME status code and message to `next` — i.e.
 * status contract preserved, envelope upgraded. Prisma is mocked, so they run
 * without a database. Success payloads are intentionally unchanged and covered
 * elsewhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    dispute: { findFirst: vi.fn() },
    submission: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return { default: db };
});

import prisma from '../../config/prisma';
import { AppError, ErrorType } from '../../utils/errorHandler';
import {
  getAuditDetails,
  submitDispute,
  getDisputeDetails,
  updateDispute,
  downloadDisputeAttachment,
} from '../dispute.controller';

const db = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
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

// Run an asyncHandler-wrapped handler and return the AppError it forwarded to
// `next` (asyncHandler resolves after `.catch(next)` runs).
async function runExpectError(
  handler: (req: never, res: never, next: never) => unknown,
  req: Record<string, unknown>,
): Promise<AppError> {
  const res = mockRes();
  const next = vi.fn();
  await handler(req as never, res as never, next as never);
  expect(next).toHaveBeenCalledTimes(1);
  // Nothing should have been written to the response on the error path.
  expect(res.json).not.toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('submitDispute — validation envelope', () => {
  it('401 when unauthenticated', async () => {
    const err = await runExpectError(submitDispute, { body: {}, file: undefined, user: undefined });
    expect(err.statusCode).toBe(401);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe('Unauthorized');
  });

  it('400 when submission_id is not a valid number', async () => {
    const err = await runExpectError(submitDispute, {
      body: { submission_id: 'abc', reason: 'x' },
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(400);
    expect(err.type).toBe(ErrorType.VALIDATION_ERROR);
    expect(err.message).toBe('Valid submission_id is required');
  });

  it('400 when reason is blank', async () => {
    const err = await runExpectError(submitDispute, {
      body: { submission_id: '10', reason: '   ' },
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Reason is required');
  });
});

describe('getAuditDetails — validation envelope', () => {
  it('401 when unauthenticated', async () => {
    const err = await runExpectError(getAuditDetails, { params: { submission_id: '10' }, user: undefined });
    expect(err.statusCode).toBe(401);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
  });

  it('404 when the audit is not found / not accessible', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(getAuditDetails, {
      params: { submission_id: '10' },
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(404);
    expect(err.type).toBe(ErrorType.NOT_FOUND_ERROR);
    expect(err.message).toBe('Audit not found or not accessible');
  });
});

describe('getDisputeDetails — validation envelope', () => {
  it('404 when the dispute is not found / not accessible', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(getDisputeDetails, {
      params: { disputeId: '3' },
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Dispute not found or not accessible');
  });
});

describe('updateDispute — validation envelope (with file cleanup preserved)', () => {
  it('401 when unauthenticated', async () => {
    const err = await runExpectError(updateDispute, {
      params: { disputeId: '3' },
      body: {},
      file: undefined,
      user: undefined,
    });
    expect(err.statusCode).toBe(401);
  });

  it('400 when disputeId is not a number', async () => {
    const err = await runExpectError(updateDispute, {
      params: { disputeId: 'abc' },
      body: { reason: 'x' },
      file: undefined,
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Valid dispute ID is required');
  });

  it('400 when reason exceeds 5000 characters', async () => {
    const err = await runExpectError(updateDispute, {
      params: { disputeId: '3' },
      body: { reason: 'a'.repeat(5001) },
      file: undefined,
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Dispute reason must be less than 5000 characters');
  });
});

describe('downloadDisputeAttachment — validation envelope', () => {
  it('401 when unauthenticated', async () => {
    const err = await runExpectError(downloadDisputeAttachment, {
      params: { disputeId: '3' },
      user: undefined,
    });
    expect(err.statusCode).toBe(401);
  });

  it('400 when disputeId is invalid', async () => {
    const err = await runExpectError(downloadDisputeAttachment, {
      params: { disputeId: '0' },
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid dispute ID');
  });

  it('404 when the dispute does not exist', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(downloadDisputeAttachment, {
      params: { disputeId: '3' },
      user: { user_id: 5 },
    });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Dispute not found');
  });

  it('403 when the caller has no relationship to the dispute', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { attachment_url: '/uploads/disputes/x.pdf', disputed_by: 99, submitted_by: 88 },
    ]);
    const err = await runExpectError(downloadDisputeAttachment, {
      params: { disputeId: '3' },
      user: { user_id: 5, role: 'CSR' },
    });
    expect(err.statusCode).toBe(403);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe('Access denied');
  });
});
