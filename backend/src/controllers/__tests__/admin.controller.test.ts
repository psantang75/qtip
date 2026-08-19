/**
 * Controller/HTTP-layer tests for the admin controller (Phase 2.2 error-envelope
 * migration). Every handler moved off the legacy `res.status(n).json(...)` shape
 * onto `asyncHandler` + thrown `AppError`. These drive the auth / validation /
 * not-found branches and assert the handler forwards an `AppError` with the SAME
 * status code and message to `next`, and that the migrated success payloads keep
 * their original shape. Prisma is mocked, so they run without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    role: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    coachingSession: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { default: db };
});

import prisma from '../../config/prisma';
import { AppError, ErrorType } from '../../utils/errorHandler';
import {
  getCompletedForms,
  getCompletedFormDetails,
  exportCompletedForm,
  getAdminCSRs,
  createAdminCoachingSession,
  getAdminCoachingSessions,
  getAdminCoachingSessionDetails,
  completeAdminCoachingSession,
  reopenAdminCoachingSession,
  downloadAdminCoachingSessionAttachment,
} from '../admin.controller';

const db = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  role: { findFirst: ReturnType<typeof vi.fn> };
};

function mockRes() {
  const res: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

async function runExpectError(
  handler: (req: never, res: never, next: never) => unknown,
  req: Record<string, unknown>,
): Promise<AppError> {
  const res = mockRes();
  const next = vi.fn();
  await handler(req as never, res as never, next as never);
  expect(next).toHaveBeenCalledTimes(1);
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

const authed = { user: { user_id: 1, role: 'admin', email: 'a@b.c' } };

beforeEach(() => {
  vi.clearAllMocks();
  // Every admin coaching/CSR query is scoped to the CSR role id; default it so
  // handlers that pass their auth/validation gates reach the branch under test.
  db.role.findFirst.mockResolvedValue({ id: 3 });
});

describe('getAdminCSRs', () => {
  it('401 when the request has no authenticated user', async () => {
    const err = await runExpectError(getAdminCSRs, { ...{ user: undefined } });
    expect(err.statusCode).toBe(401);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe('Unauthorized');
  });

  it('returns the { success, data, total } shape on success', async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { id: 7, username: 'jo', email: 'jo@x.com', department_name: 'Support' },
    ]);
    const res = mockRes();
    const next = vi.fn();
    await (getAdminCSRs as unknown as (r: never, s: never, n: never) => Promise<void>)(
      authed as never,
      res as never,
      next as never,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 7, username: 'jo', email: 'jo@x.com', department_name: 'Support' }],
      total: 1,
    });
  });
});

describe('getCompletedForms — validation', () => {
  it('400 when form_id is not a valid number', async () => {
    const err = await runExpectError(getCompletedForms, { query: { form_id: 'abc' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid form_id parameter');
  });

  it('400 when the search term is too long', async () => {
    const err = await runExpectError(getCompletedForms, { query: { search: 'x'.repeat(101) } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Search query too long (max 100 characters)');
  });
});

describe('getCompletedFormDetails', () => {
  it('400 when the submission id is invalid', async () => {
    const err = await runExpectError(getCompletedFormDetails, { params: { id: 'abc' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid submission ID');
  });

  it('404 when the submission does not exist', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const err = await runExpectError(getCompletedFormDetails, { params: { id: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.type).toBe(ErrorType.NOT_FOUND_ERROR);
    expect(err.message).toBe('Submission not found');
  });
});

describe('exportCompletedForm', () => {
  it('400 when the submission id is invalid', async () => {
    const err = await runExpectError(exportCompletedForm, { params: { id: '-1' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid submission ID');
  });

  it('404 when the submission does not exist', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const err = await runExpectError(exportCompletedForm, { params: { id: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Submission not found');
  });
});

describe('createAdminCoachingSession — validation', () => {
  it('401 when unauthenticated', async () => {
    const err = await runExpectError(createAdminCoachingSession, { body: {} });
    expect(err.statusCode).toBe(401);
  });

  it('400 when required fields are missing', async () => {
    const err = await runExpectError(createAdminCoachingSession, { ...authed, body: {} });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Missing required fields: csr_id, session_date, status');
  });

  it('400 when no topics are supplied', async () => {
    const err = await runExpectError(createAdminCoachingSession, {
      ...authed,
      body: { csr_id: '2', session_date: '2026-01-01', status: 'SCHEDULED' },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('At least one topic is required');
  });

  it('400 on an invalid status', async () => {
    const err = await runExpectError(createAdminCoachingSession, {
      ...authed,
      body: { csr_id: '2', session_date: '2026-01-01', status: 'BOGUS', topic_ids: [1] },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid status. Must be SCHEDULED or COMPLETED');
  });
});

describe('getAdminCoachingSessions', () => {
  it('401 when unauthenticated', async () => {
    const err = await runExpectError(getAdminCoachingSessions, { query: {} });
    expect(err.statusCode).toBe(401);
  });

  it('400 when the page size exceeds the handler cap', async () => {
    const err = await runExpectError(getAdminCoachingSessions, { ...authed, query: { limit: '200' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid pagination parameters');
  });
});

describe('getAdminCoachingSessionDetails', () => {
  it('400 on an invalid session id', async () => {
    const err = await runExpectError(getAdminCoachingSessionDetails, { ...authed, params: { sessionId: 'abc' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid session ID');
  });

  it('404 when the session is not found', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const err = await runExpectError(getAdminCoachingSessionDetails, { ...authed, params: { sessionId: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Coaching session not found');
  });
});

describe('completeAdminCoachingSession', () => {
  it('400 on an invalid session id', async () => {
    const err = await runExpectError(completeAdminCoachingSession, { ...authed, params: { sessionId: 'abc' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid session ID');
  });

  it('404 when the session is not found', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const err = await runExpectError(completeAdminCoachingSession, { ...authed, params: { sessionId: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Coaching session not found');
  });

  it('400 when the session is already completed', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 5, current_status: 'COMPLETED', csr_name: 'jo' }]);
    const err = await runExpectError(completeAdminCoachingSession, { ...authed, params: { sessionId: '5' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Coaching session is already completed');
  });
});

describe('reopenAdminCoachingSession', () => {
  it('400 when the session is not completed', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 5, current_status: 'SCHEDULED', csr_name: 'jo' }]);
    const err = await runExpectError(reopenAdminCoachingSession, { ...authed, params: { sessionId: '5' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Can only reopen completed coaching sessions');
  });
});

describe('downloadAdminCoachingSessionAttachment', () => {
  it('400 on an invalid session id', async () => {
    const err = await runExpectError(downloadAdminCoachingSessionAttachment, { ...authed, params: { sessionId: 'abc' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid session ID');
  });

  it('404 when the session or attachment is not found', async () => {
    db.$queryRaw.mockResolvedValue([]);
    const err = await runExpectError(downloadAdminCoachingSessionAttachment, { ...authed, params: { sessionId: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Coaching session not found or no attachment');
  });
});
