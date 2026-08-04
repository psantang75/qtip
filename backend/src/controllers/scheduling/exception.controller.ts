/**
 * Exception log endpoints (single + bulk) plus the Paychex time-off import
 * review. Transport-only.
 */
import { Response } from 'express';
import {
  AuthReq, resolveScope, listExceptions, createException, deleteException, bulkLogException,
  deriveTimeOffExceptions,
} from '../../services/scheduling';
import { respondWithError } from './respond';
import { addDays, fmtLocal } from '../../services/scheduling/schedule.dates';

export const getExceptions = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await listExceptions(scope, {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      userId: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'getExceptions', error);
  }
};

export const postException = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await createException(scope, req.body, req.user!.user_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postException', error);
  }
};

export const removeException = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await deleteException(scope, parseInt(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'removeException', error);
  }
};

/**
 * What the punch feed's Non-Work blocks currently mean, classified live rather
 * than read from a stored snapshot. Running the same derivation the importer
 * runs — with dryRun — is what keeps the review page honest: it can never show a
 * result the engine did not actually score.
 */
export const getTimeOffImportReview = async (req: AuthReq, res: Response) => {
  try {
    const to = (req.query.to as string) || fmtLocal(new Date());
    const from = (req.query.from as string) || addDays(to, -29);
    const data = await deriveTimeOffExceptions(from, to, { dryRun: true });
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'getTimeOffImportReview', error);
  }
};

export const postBulkException = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await bulkLogException({
      scope,
      userIds: req.body.user_ids,
      from: req.body.from,
      to: req.body.to,
      exception_type_id: req.body.exception_type_id,
      is_full_day: req.body.is_full_day,
      start: req.body.start,
      end: req.body.end,
      actorId: req.user!.user_id,
      dryRun: !!req.body.dry_run,
    });
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postBulkException', error);
  }
};
