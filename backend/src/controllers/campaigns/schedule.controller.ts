/**
 * Campaign SCHEDULE controllers — schedules, membership, month projection and
 * per-day overrides. Every handler is department-scope-aware via the services
 * (which call resolveScope with req.pageAccess). Transport-only.
 */
import { Response } from 'express';
import { AuthReq } from '../../services/scheduling';
import {
  listSchedules, listWritableDepartments, createSchedule, updateSchedule, deleteSchedule,
  getMembership, setMembership, projectMonth, setDayCampaign, setMonthPublished,
} from '../../services/campaigns';
import { respondWithError } from '../scheduling/respond';

const includeInactive = (req: AuthReq) => req.query.include_inactive === 'true';

// ── Schedules ─────────────────────────────────────────────────────────────────
export const getSchedules = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await listSchedules(req, includeInactive(req)) }); }
  catch (error) { respondWithError(res, 'getSchedules', error); }
};
export const getWritableDepartments = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await listWritableDepartments(req) }); }
  catch (error) { respondWithError(res, 'getWritableDepartments', error); }
};
export const postSchedule = async (req: AuthReq, res: Response) => {
  try { res.status(201).json({ success: true, data: await createSchedule(req, req.body) }); }
  catch (error) { respondWithError(res, 'postSchedule', error); }
};
export const putSchedule = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await updateSchedule(req, parseInt(req.params.id), req.body) }); }
  catch (error) { respondWithError(res, 'putSchedule', error); }
};
export const removeSchedule = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await deleteSchedule(req, parseInt(req.params.id)) }); }
  catch (error) { respondWithError(res, 'removeSchedule', error); }
};

// ── Publishing ────────────────────────────────────────────────────────────────
export const putMonthPublish = async (req: AuthReq, res: Response) => {
  try {
    const { year, month, is_published } = req.body;
    res.json({ success: true, data: await setMonthPublished(req, parseInt(req.params.id), year, month, !!is_published) });
  } catch (error) { respondWithError(res, 'putMonthPublish', error); }
};

// ── Membership ─────────────────────────────────────────────────────────────────
export const getScheduleMembership = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await getMembership(req, parseInt(req.params.id)) }); }
  catch (error) { respondWithError(res, 'getScheduleMembership', error); }
};
export const putScheduleMembership = async (req: AuthReq, res: Response) => {
  try {
    res.json({ success: true, data: await setMembership(req, parseInt(req.params.id), req.body.campaign_item_id, !!req.body.is_enabled) });
  } catch (error) { respondWithError(res, 'putScheduleMembership', error); }
};

// ── Month projection + overrides ────────────────────────────────────────────
export const getScheduleMonth = async (req: AuthReq, res: Response) => {
  try {
    const year = parseInt(String(req.query.year));
    const month = parseInt(String(req.query.month));
    res.json({ success: true, data: await projectMonth(req, parseInt(req.params.id), year, month) });
  } catch (error) { respondWithError(res, 'getScheduleMonth', error); }
};
export const putDayCampaign = async (req: AuthReq, res: Response) => {
  try {
    res.json({ success: true, data: await setDayCampaign(req, parseInt(req.params.id), req.body.occurrence_date, req.body.campaign_item_id, !!req.body.is_on) });
  } catch (error) { respondWithError(res, 'putDayCampaign', error); }
};
