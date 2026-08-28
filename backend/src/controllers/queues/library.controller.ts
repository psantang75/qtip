/**
 * Phone queue library controller — admin-only writes, gated at the route.
 *
 * Thin by design: parse, delegate, respond. Uses `asyncHandler` + `AppError`
 * (the canonical envelope in .cursor/rules/backend-api-conventions.mdc) rather
 * than the scheduling slice's legacy `respond.ts` helper, because this is a new
 * surface and there is nothing here to stay backwards-compatible with.
 */
import { Response } from 'express';
import { asyncHandler, createValidationError } from '../../utils/errorHandler';
import {
  listQueuesWithDepartments, createQueue, updateQueue, setQueueActive, reorderQueues,
} from '../../services/queues';
import type { AuthReq } from '../../services/queues';

/** Path :id, rejected as a 400 rather than reaching Prisma as NaN. */
function queueId(req: AuthReq): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw createValidationError('Invalid queue id');
  return id;
}

export const getLibrary = asyncHandler(async (req: AuthReq, res: Response) => {
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  res.json({ queues: await listQueuesWithDepartments(includeInactive) });
});

export const postQueue = asyncHandler(async (req: AuthReq, res: Response) => {
  res.status(201).json({ queue: await createQueue(req.body) });
});

export const putQueue = asyncHandler(async (req: AuthReq, res: Response) => {
  res.json({ queue: await updateQueue(queueId(req), req.body) });
});

export const patchQueueActive = asyncHandler(async (req: AuthReq, res: Response) => {
  res.json({ queue: await setQueueActive(queueId(req), req.body.is_active) });
});

export const postReorderQueues = asyncHandler(async (req: AuthReq, res: Response) => {
  res.json({ queues: await reorderQueues(req.body.order) });
});
