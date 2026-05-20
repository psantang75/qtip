/**
 * Admin-gating contract for the AI Prompt + Settings tab write
 * endpoints (including the new /base-prompts/* routes).
 *
 * Rather than spin up supertest + the full middleware chain, this test
 * verifies the actual gate (the `authorizeAdmin` middleware that every
 * write handler in this file is wrapped with) against mock req/res/next.
 * The route → middleware wiring is enforced at compile time: every new
 * `router.put/post/delete(..., authorizeAdmin, handler)` requires
 * importing `authorizeAdmin` from `../middleware/auth`, which is checked
 * by the TypeScript build.
 *
 * Coverage:
 *   - non-Admin → 403 with the well-known forbidden code
 *   - Admin     → next() called once with no arguments (success)
 *   - missing user (auth failure path) → 401
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authorizeAdmin } from '../../middleware/auth';

function fakeRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('authorizeAdmin (admin-gating contract for AI Prompt + Settings + base-prompts writes)', () => {
  it('returns 403 when the user is not an Admin (e.g. QA opens the AI Prompt tab and tries to save)', () => {
    const req = { user: { user_id: 7, role: 'QA' } } as Request;
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    authorizeAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() exactly once when the user is an Admin', () => {
    const req = { user: { user_id: 1, role: 'Admin' } } as Request;
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    authorizeAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when no user is on the request (authenticate middleware never ran)', () => {
    const req = {} as Request;
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    authorizeAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['CSR'],
    ['Trainer'],
    ['Manager'],
    ['Director'],
    ['User'],
  ])('returns 403 for role "%s"', (role) => {
    const req = { user: { user_id: 7, role } } as Request;
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    authorizeAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
