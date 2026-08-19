/**
 * Controller/HTTP-layer tests for the training-resource controller (Phase 2.2
 * error-envelope migration). Handlers moved onto `asyncHandler` + thrown
 * `AppError`; the signed-view-token endpoints keep their 401 status via a small
 * `unauthorized()` helper (the factory default is 403). Prisma + jwt are mocked,
 * so these run without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() };
  return { default: db };
});

// environment is intentionally NOT mocked — `getJwtSecret()` is only used to
// mint/verify tokens and jwt is fully mocked below, so the real config module
// (which the logger also depends on) is left intact.
vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'signed.jwt.token'), verify: vi.fn() },
}));

import prisma from '../../config/prisma';
import jwt from 'jsonwebtoken';
import { AppError, ErrorType } from '../../utils/errorHandler';
import {
  createResource,
  updateResource,
  toggleResourceStatus,
  generateViewToken,
  serveFileWithToken,
  downloadResourceFile,
} from '../resource.controller';

const db = prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> };
const jwtVerify = (jwt as unknown as { verify: ReturnType<typeof vi.fn> }).verify;
const VIEW_TOKEN_AUDIENCE = 'qtip:resource-view';

function mockRes() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    setHeader: vi.fn(() => res),
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
  expect(res.json).not.toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

const asUser = { user_id: 9, role: 'trainer' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createResource — validation', () => {
  it('400 when title is missing', async () => {
    const err = await runExpectError(createResource, { user: asUser, body: {}, file: undefined });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('title is required');
  });

  it('400 when a URL resource has no url', async () => {
    const err = await runExpectError(createResource, {
      user: asUser,
      body: { title: 'Doc', resource_type: 'URL' },
      file: undefined,
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('url is required for URL resources');
  });
});

describe('updateResource', () => {
  it('404 when the resource does not exist', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(updateResource, { params: { id: '3' }, body: {}, file: undefined });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource not found');
  });
});

describe('toggleResourceStatus', () => {
  it('400 when is_active is missing', async () => {
    const err = await runExpectError(toggleResourceStatus, { params: { id: '3' }, body: {} });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('is_active is required');
  });

  it('404 when the resource does not exist', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(toggleResourceStatus, { params: { id: '3' }, body: { is_active: true } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource not found');
  });
});

describe('generateViewToken', () => {
  it('404 when the file row is missing', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(generateViewToken, { params: { id: '3' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('File not found');
  });
});

describe('serveFileWithToken — token auth (401s)', () => {
  it('401 when no token is supplied', async () => {
    const err = await runExpectError(serveFileWithToken, { params: { id: '3' }, query: {} });
    expect(err.statusCode).toBe(401);
    expect(err.type).toBe(ErrorType.AUTHORIZATION_ERROR);
    expect(err.message).toBe('Token required');
  });

  it('401 when the token fails verification', async () => {
    jwtVerify.mockImplementationOnce(() => { throw new Error('bad sig'); });
    const err = await runExpectError(serveFileWithToken, { params: { id: '3' }, query: { token: 'x' } });
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid or expired token');
  });

  it('401 when the token audience/rid does not match', async () => {
    jwtVerify.mockReturnValueOnce({ aud: 'other', rid: 3 });
    const err = await runExpectError(serveFileWithToken, { params: { id: '3' }, query: { token: 'x' } });
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid token');
  });

  it('404 when the token is valid but the file row is gone', async () => {
    jwtVerify.mockReturnValueOnce({ aud: VIEW_TOKEN_AUDIENCE, rid: 3 });
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(serveFileWithToken, { params: { id: '3' }, query: { token: 'x' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('File not found');
  });
});

describe('downloadResourceFile', () => {
  it('404 when the file row is missing', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(downloadResourceFile, { params: { id: '3' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('File not found');
  });
});
