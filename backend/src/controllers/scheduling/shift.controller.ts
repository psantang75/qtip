/**
 * Shift + lifecycle endpoints. Transport-only: scope resolution and rules live
 * in services/scheduling/.
 */
import { Response } from 'express';
import {
  AuthReq, resolveScope, readGrid, readMySchedule, upsertShift, deleteShift,
  publishRange, unpublishRange, adminUnlockShift, listRoster,
} from '../../services/scheduling';
import { applySchedule } from '../../services/scheduling';
import { respondWithError } from './respond';

export const getGrid = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await readGrid(scope, req.query.from as string, req.query.to as string);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'getGrid', error);
  }
};

export const getRoster = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    res.json({ success: true, data: await listRoster(scope) });
  } catch (error) {
    respondWithError(res, 'getRoster', error);
  }
};

export const getMySchedule = async (req: AuthReq, res: Response) => {
  try {
    const data = await readMySchedule(req.user!.user_id, req.query.from as string, req.query.to as string);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'getMySchedule', error);
  }
};

export const putShift = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await upsertShift(scope, req.body, req.user!.user_id);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'putShift', error);
  }
};

export const removeShift = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await deleteShift(scope, parseInt(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'removeShift', error);
  }
};

export const postApply = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await applySchedule({
      scope,
      mode: req.body.mode,
      userIds: req.body.user_ids,
      dates: req.body.dates,
      templateId: req.body.template_id,
      sourceWeekStart: req.body.source_week_start,
      actorId: req.user!.user_id,
      dryRun: !!req.body.dry_run,
    });
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postApply', error);
  }
};

export const postPublish = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await publishRange(scope, req.body.user_ids, req.body.dates, req.user!.user_id, !!req.body.confirm_elapsed);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postPublish', error);
  }
};

export const postUnpublish = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await unpublishRange(scope, req.body.user_ids, req.body.dates, req.user!.user_id);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postUnpublish', error);
  }
};

export const postUnlock = async (req: AuthReq, res: Response) => {
  try {
    const scope = await resolveScope(req);
    const data = await adminUnlockShift(scope, parseInt(req.params.id), req.user!.user_id);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postUnlock', error);
  }
};
