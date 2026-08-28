/**
 * Solved queue coverage for a department-day, plus the manual day overrides.
 *
 * The coverage read is computed on every request — there is no stored plan to go
 * stale, so a PTO row added a minute ago is already reflected.
 */
import { Response } from 'express';
import { asyncHandler, createValidationError, createAuthorizationError } from '../../utils/errorHandler';
import {
  resolveScope, solveQueueDay, solveQueueWeek, listOverrides, setOverride, clearOverrides, deleteOverride,
} from '../../services/queues';
import type { AuthReq } from '../../services/queues';

function intQuery(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw createValidationError(`Invalid ${label}`);
  return n;
}

const wantsDraft = (req: AuthReq): boolean =>
  req.query.include_draft === '1' || req.query.include_draft === 'true';

export const getCoverage = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  const result = await solveQueueDay(
    scope,
    intQuery(req.query.department_id, 'department id'),
    String(req.query.date),
    { includeDraft: wantsDraft(req) },
  );
  res.json(result);
});

export const getWeekCoverage = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  const result = await solveQueueWeek(
    scope,
    intQuery(req.query.department_id, 'department id'),
    String(req.query.start),
    { includeDraft: wantsDraft(req) },
  );
  res.json(result);
});

export const getOverrides = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  const overrides = await listOverrides(
    scope,
    intQuery(req.query.department_id, 'department id'),
    String(req.query.date),
  );
  res.json({ overrides });
});

export const putOverride = asyncHandler(async (req: AuthReq, res: Response) => {
  // `authenticate` guarantees this; the guard is here to narrow the type.
  const actorId = req.user?.user_id;
  if (!actorId) throw createAuthorizationError('Not signed in');
  const scope = await resolveScope(req);
  res.json({ overrides: await setOverride(scope, req.body, actorId) });
});

export const putOverrideClear = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json({ overrides: await clearOverrides(scope, req.body) });
});

export const removeOverride = asyncHandler(async (req: AuthReq, res: Response) => {
  const scope = await resolveScope(req);
  res.json(await deleteOverride(scope, intQuery(req.params.id, 'override id')));
});
