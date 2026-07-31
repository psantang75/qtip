/**
 * Exception log endpoints (single + bulk). Transport-only.
 */
import { Response } from 'express';
import {
  AuthReq, resolveScope, listExceptions, createException, deleteException, bulkLogException,
} from '../../services/scheduling';
import { respondWithError } from './respond';

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
