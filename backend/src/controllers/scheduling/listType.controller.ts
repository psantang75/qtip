/**
 * Admin-managed scheduling lists: exception types, activity types, coverage
 * thresholds. Read handlers are open to schedule viewers; write handlers are
 * gated admin-only at the route layer. Transport-only.
 */
import { Response } from 'express';
import {
  AuthReq,
  listExceptionTypes, createExceptionType, updateExceptionType, setExceptionTypeActive, reorderExceptionTypes,
  listActivityTypes, createActivityType, updateActivityType, setActivityTypeActive, reorderActivityTypes,
  listCoverageThresholds, upsertCoverageThreshold, deleteCoverageThreshold, saveCoverageWindows,
} from '../../services/scheduling';
import { respondWithError } from './respond';

const includeInactive = (req: AuthReq) => req.query.include_inactive === 'true';

// ── Exception types ──────────────────────────────────────────────────────────
export const getExceptionTypes = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await listExceptionTypes(includeInactive(req)) }); }
  catch (error) { respondWithError(res, 'getExceptionTypes', error); }
};
export const postExceptionType = async (req: AuthReq, res: Response) => {
  try { res.status(201).json({ success: true, data: await createExceptionType(req.body) }); }
  catch (error) { respondWithError(res, 'postExceptionType', error); }
};
export const putExceptionType = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await updateExceptionType(parseInt(req.params.id), req.body) }); }
  catch (error) { respondWithError(res, 'putExceptionType', error); }
};
export const patchExceptionTypeActive = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await setExceptionTypeActive(parseInt(req.params.id), !!req.body.is_active) }); }
  catch (error) { respondWithError(res, 'patchExceptionTypeActive', error); }
};
export const postReorderExceptionTypes = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await reorderExceptionTypes(req.body.order) }); }
  catch (error) { respondWithError(res, 'postReorderExceptionTypes', error); }
};

// ── Activity types ───────────────────────────────────────────────────────────
export const getActivityTypes = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await listActivityTypes(includeInactive(req)) }); }
  catch (error) { respondWithError(res, 'getActivityTypes', error); }
};
export const postActivityType = async (req: AuthReq, res: Response) => {
  try { res.status(201).json({ success: true, data: await createActivityType(req.body) }); }
  catch (error) { respondWithError(res, 'postActivityType', error); }
};
export const putActivityType = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await updateActivityType(parseInt(req.params.id), req.body) }); }
  catch (error) { respondWithError(res, 'putActivityType', error); }
};
export const patchActivityTypeActive = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await setActivityTypeActive(parseInt(req.params.id), !!req.body.is_active) }); }
  catch (error) { respondWithError(res, 'patchActivityTypeActive', error); }
};
export const postReorderActivityTypes = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await reorderActivityTypes(req.body.order) }); }
  catch (error) { respondWithError(res, 'postReorderActivityTypes', error); }
};

// ── Coverage thresholds ──────────────────────────────────────────────────────
export const getCoverageThresholds = async (_req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await listCoverageThresholds() }); }
  catch (error) { respondWithError(res, 'getCoverageThresholds', error); }
};
export const putCoverageThreshold = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await upsertCoverageThreshold(req.body) }); }
  catch (error) { respondWithError(res, 'putCoverageThreshold', error); }
};
export const removeCoverageThreshold = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await deleteCoverageThreshold(parseInt(req.params.departmentId)) }); }
  catch (error) { respondWithError(res, 'removeCoverageThreshold', error); }
};
export const putCoverageWindows = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await saveCoverageWindows(parseInt(req.params.departmentId), req.body.windows) }); }
  catch (error) { respondWithError(res, 'putCoverageWindows', error); }
};
