/**
 * Admin unlock / reopen controllers. Transport-only — every guard lives in
 * services/unlock/unlock.service.ts so the rules hold regardless of caller.
 *
 * UnlockServiceError carries a `.code` (ADMIN_ONLY, REOPEN_CAP_REACHED,
 * BEYOND_WINDOW, ...) that the UI branches on — BEYOND_WINDOW in particular
 * drives the break-glass second confirm — so it is forwarded alongside the
 * message, mirroring controllers/scheduling/respond.ts.
 */
import { Request, Response } from 'express';
import logger from '../config/logger';
import { UnlockServiceError } from '../services/unlock/unlock.types';
import { unlockSubmission, unlockDispute } from '../services/unlock/unlock.service';
import { listUnlocks, getUnlockStats, getUnlockHistoryForSubmission } from '../services/unlock/unlock.query.service';
import { notifyRecordUnlocked } from '../services/unlock/unlock.notify';
import { UnlockRequestSchema, UnlockListQuerySchema } from '../validation/unlock.validation';

function respondWithError(res: Response, label: string, error: unknown): Response {
  if (error instanceof UnlockServiceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
  }
  logger.error(`[UNLOCK] ${label} error:`, error);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

function parseBody(res: Response, body: unknown) {
  const parsed = UnlockRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid request',
      code: 'VALIDATION_ERROR',
    });
    return null;
  }
  return parsed.data;
}

export const postUnlockSubmission = async (req: Request, res: Response) => {
  const body = parseBody(res, req.body);
  if (!body) return;
  try {
    const result = await unlockSubmission(
      parseInt(req.params.submissionId, 10),
      req.user!.user_id,
      req.user!.role === 'Admin',
      {
        reason_code: body.reason_code,
        reason_note: body.reason_note,
        confirmBeyondWindow: body.confirm_beyond_window,
      },
    );
    // Mail failures must never roll back the unlock — same posture as
    // submitDispute in dispute.controller.ts.
    void notifyRecordUnlocked(result, req.user!.user_id, body.reason_code, body.reason_note);
    res.json({ success: true, data: result });
  } catch (error) {
    respondWithError(res, 'postUnlockSubmission', error);
  }
};

export const postUnlockDispute = async (req: Request, res: Response) => {
  const body = parseBody(res, req.body);
  if (!body) return;
  try {
    const result = await unlockDispute(
      parseInt(req.params.disputeId, 10),
      req.user!.user_id,
      req.user!.role === 'Admin',
      {
        reason_code: body.reason_code,
        reason_note: body.reason_note,
        confirmBeyondWindow: body.confirm_beyond_window,
      },
    );
    void notifyRecordUnlocked(result, req.user!.user_id, body.reason_code, body.reason_note);
    res.json({ success: true, data: result });
  } catch (error) {
    respondWithError(res, 'postUnlockDispute', error);
  }
};

function parseListQuery(res: Response, query: unknown) {
  const parsed = UnlockListQuerySchema.safeParse(query ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid query',
      code: 'VALIDATION_ERROR',
    });
    return null;
  }
  const q = parsed.data;
  return {
    page: q.page ?? 1,
    limit: q.limit ?? 50,
    dateStart: q.date_start,
    dateEnd: q.date_end,
    entityType: q.entity_type,
    reasonCode: q.reason_code,
    state: q.state,
    unlockedBy: q.unlocked_by,
    search: q.search,
  };
}

export const getUnlockRegister = async (req: Request, res: Response) => {
  const params = parseListQuery(res, req.query);
  if (!params) return;
  try {
    res.json({ success: true, ...(await listUnlocks(params)) });
  } catch (error) {
    respondWithError(res, 'getUnlockRegister', error);
  }
};

export const getUnlockRegisterStats = async (req: Request, res: Response) => {
  const params = parseListQuery(res, req.query);
  if (!params) return;
  try {
    res.json({ success: true, data: await getUnlockStats(params) });
  } catch (error) {
    respondWithError(res, 'getUnlockRegisterStats', error);
  }
};

export const getSubmissionUnlockHistory = async (req: Request, res: Response) => {
  try {
    const submissionId = parseInt(req.params.submissionId, 10);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      res.status(400).json({ success: false, message: 'Invalid submission id' });
      return;
    }
    res.json({ success: true, data: await getUnlockHistoryForSubmission(submissionId) });
  } catch (error) {
    respondWithError(res, 'getSubmissionUnlockHistory', error);
  }
};
