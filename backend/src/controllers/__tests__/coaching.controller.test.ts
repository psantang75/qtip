/**
 * Controller/HTTP-layer tests for the coaching controller.
 *
 * Guards the error-envelope migration (Phase 2.2): every handler was moved off
 * the legacy `res.status(n).json({ success:false, message })` shape onto
 * `asyncHandler` + thrown `AppError` (rendered by the global middleware). These
 * tests drive the validation / not-found / locked branches and assert the
 * handler forwards an `AppError` with the SAME status code and message to
 * `next` — i.e. status contract preserved, envelope upgraded.
 *
 * Notably the legacy 403 lock responses used to carry `code: 'LEGACY_LOCKED'`;
 * the frontend never reads that code (it mirrors the lock rule client-side), so
 * the migration preserves the 403 + `LEGACY_LOCKED_MESSAGE` text only. Prisma /
 * lock / notify collaborators are mocked, so these run without a database.
 * Success payloads are intentionally unchanged and covered elsewhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    auditLog: { create: vi.fn() },
  };
  return { default: db };
});

vi.mock('../../services/legacyLock', () => ({
  checkLegacyLock: vi.fn(),
  LEGACY_LOCKED_MESSAGE: 'This record is locked and can no longer be edited.',
}));

vi.mock('../../services/coaching/coaching.notify', () => ({
  notifyCoachingStatus: vi.fn(),
}));

vi.mock('../../utils/coachingAutoAdvance', () => ({
  hasCsrRequirements: vi.fn().mockResolvedValue(false),
  applyAutoAdvance: vi.fn(),
}));

import prisma from '../../config/prisma';
import { checkLegacyLock, LEGACY_LOCKED_MESSAGE } from '../../services/legacyLock';
import { AppError, ErrorType } from '../../utils/errorHandler';
import {
  getCoachingSessionDetail,
  createCoachingSession,
  updateCoachingSession,
  deliverCoachingSession,
  completeCoachingSession,
  closeCoachingSession,
  flagFollowUp,
  downloadAttachment,
  setSessionStatus,
  getCSRCoachingHistory,
} from '../coaching.controller';

const db = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
};
const lock = checkLegacyLock as unknown as ReturnType<typeof vi.fn>;

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
  expect(res.json).not.toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

const asManager = { user_id: 5, role: 'manager' };

beforeEach(() => {
  vi.clearAllMocks();
  lock.mockResolvedValue({ allowed: true });
});

describe('getCoachingSessionDetail — validation envelope', () => {
  it('400 when the id is not a valid number', async () => {
    const err = await runExpectError(getCoachingSessionDetail, {
      params: { id: 'abc' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.type).toBe(ErrorType.VALIDATION_ERROR);
    expect(err.message).toBe('Invalid session ID');
  });

  it('404 when the session is not found / access denied', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(getCoachingSessionDetail, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
    expect(err.type).toBe(ErrorType.NOT_FOUND_ERROR);
    expect(err.message).toBe('Session not found or access denied');
  });
});

describe('createCoachingSession — validation envelope', () => {
  it('400 when required fields are missing', async () => {
    const err = await runExpectError(createCoachingSession, {
      body: {},
      file: undefined,
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(
      'Required: csr_ids, session_date, coaching_purpose, coaching_format, source_type',
    );
  });

  it('400 when no topics are supplied', async () => {
    const err = await runExpectError(createCoachingSession, {
      body: {
        csr_ids: '7',
        session_date: '2026-01-01',
        coaching_purpose: '1',
        coaching_format: '2',
        source_type: '3',
        topic_ids: '',
      },
      file: undefined,
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('At least one topic is required');
  });
});

describe('updateCoachingSession — validation / lock envelope', () => {
  it('404 when the session is not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(updateCoachingSession, {
      params: { id: '10' },
      body: {},
      file: undefined,
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Session not found or access denied');
  });

  it('400 when the session is closed', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'CLOSED' }]);
    const err = await runExpectError(updateCoachingSession, {
      params: { id: '10' },
      body: {},
      file: undefined,
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Cannot edit a closed or canceled session');
  });

  it('403 with the legacy lock message when locked', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'DRAFT' }]);
    lock.mockResolvedValueOnce({ allowed: false, message: LEGACY_LOCKED_MESSAGE });
    const err = await runExpectError(updateCoachingSession, {
      params: { id: '10' },
      body: {},
      file: undefined,
      user: asManager,
    });
    expect(err.statusCode).toBe(403);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe(LEGACY_LOCKED_MESSAGE);
  });
});

describe('deliverCoachingSession — validation / lock envelope', () => {
  it('404 when the session is not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(deliverCoachingSession, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
  });

  it('400 when the session is not a DRAFT', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'SCHEDULED' }]);
    const err = await runExpectError(deliverCoachingSession, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Can only schedule a DRAFT session');
  });

  it('403 when locked', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'DRAFT' }]);
    lock.mockResolvedValueOnce({ allowed: false, message: LEGACY_LOCKED_MESSAGE });
    const err = await runExpectError(deliverCoachingSession, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe(LEGACY_LOCKED_MESSAGE);
  });
});

describe('completeCoachingSession — validation envelope', () => {
  it('404 when not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(completeCoachingSession, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
  });

  it('400 when already completed / closed', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'COMPLETED' }]);
    const err = await runExpectError(completeCoachingSession, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Session is already completed or closed');
  });
});

describe('closeCoachingSession — validation envelope', () => {
  it('400 when already closed', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'CLOSED' }]);
    const err = await runExpectError(closeCoachingSession, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Session is already closed');
  });
});

describe('flagFollowUp — validation envelope', () => {
  it('404 when not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(flagFollowUp, {
      params: { id: '10' },
      body: {},
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
  });
});

describe('downloadAttachment — validation envelope', () => {
  it('404 when no session / attachment / access', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(downloadAttachment, {
      params: { id: '10' },
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Session not found, no attachment, or access denied');
  });
});

describe('setSessionStatus — validation envelope', () => {
  it('400 when the status is not a known value', async () => {
    const err = await runExpectError(setSessionStatus, {
      params: { id: '10' },
      body: { status: 'BOGUS' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid status');
  });

  it('404 when the session is not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(setSessionStatus, {
      params: { id: '10' },
      body: { status: 'SCHEDULED' },
      user: asManager,
    });
    expect(err.statusCode).toBe(404);
  });

  it('400 when trying to reopen a closed / canceled session', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 10, status: 'CLOSED' }]);
    const err = await runExpectError(setSessionStatus, {
      params: { id: '10' },
      body: { status: 'SCHEDULED' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Closed or canceled sessions cannot be reopened');
  });
});

describe('getCSRCoachingHistory — validation envelope', () => {
  it('400 when the CSR id is invalid', async () => {
    const err = await runExpectError(getCSRCoachingHistory, {
      params: { csrId: 'abc' },
      user: asManager,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid CSR ID');
  });
});
