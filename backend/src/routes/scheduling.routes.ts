/**
 * Scheduling routes. Mirrors writeup.routes.ts: authenticate on all, then
 * page-access gates via authorizePage('sched_*', level). Admin-managed lists
 * (types, coverage thresholds) additionally require authorizeAdmin on writes.
 *
 * Page keys:
 *   sched_calendar   — view (OWN self schedule), viewAll (grid), edit (write)
 *   sched_exceptions — viewAll (list), edit (write)
 * Templates ride on sched_calendar edit (no separate page — managed in a dialog).
 */
import { Router, RequestHandler } from 'express';
import { authenticate, authorizePage, authorizeAdmin } from '../middleware/auth';
import { validateSchema } from '../validation/csr.validation';
import {
  GridQuerySchema, ShiftUpsertSchema, ApplyScheduleSchema, PublishSchema, UnpublishSchema,
  TemplateSchema, ExceptionCreateSchema, BulkExceptionSchema,
  ExceptionTypeSchema, ActivityTypeSchema, CoverageThresholdSchema,
} from '../validation/schedule.validation';
import {
  getGrid, getRoster, getMySchedule, putShift, removeShift, postApply, postPublish, postUnpublish, postUnlock,
  getTemplates, getTemplateById, postTemplate, putTemplate, patchTemplateActive, postDuplicateTemplate,
  getExceptions, postException, removeException, postBulkException,
  getExceptionTypes, postExceptionType, putExceptionType, patchExceptionTypeActive, postReorderExceptionTypes,
  getActivityTypes, postActivityType, putActivityType, patchActivityTypeActive,
  getCoverageThresholds, putCoverageThreshold, removeCoverageThreshold,
} from '../controllers/scheduling';

const router = Router();
router.use(authenticate as unknown as RequestHandler);

const calView    = authorizePage('sched_calendar', 'view')    as unknown as RequestHandler;
const calViewAll = authorizePage('sched_calendar', 'viewAll') as unknown as RequestHandler;
const calEdit    = authorizePage('sched_calendar', 'edit')    as unknown as RequestHandler;
const excViewAll = authorizePage('sched_exceptions', 'viewAll') as unknown as RequestHandler;
const excEdit    = authorizePage('sched_exceptions', 'edit')    as unknown as RequestHandler;
const admin      = authorizeAdmin as unknown as RequestHandler;

// ── Lists (read for any viewer, write admin-only) ────────────────────────────
router.get('/activity-types',   calView, getActivityTypes as unknown as RequestHandler);
router.get('/exception-types',  calView, getExceptionTypes as unknown as RequestHandler);
router.get('/coverage-thresholds', calView, getCoverageThresholds as unknown as RequestHandler);

router.post('/exception-types',        admin, validateSchema(ExceptionTypeSchema), postExceptionType as unknown as RequestHandler);
router.put('/exception-types/:id',     admin, putExceptionType as unknown as RequestHandler);
router.patch('/exception-types/:id/active', admin, patchExceptionTypeActive as unknown as RequestHandler);
router.post('/exception-types/reorder', admin, postReorderExceptionTypes as unknown as RequestHandler);
router.post('/activity-types',         admin, validateSchema(ActivityTypeSchema), postActivityType as unknown as RequestHandler);
router.put('/activity-types/:id',      admin, putActivityType as unknown as RequestHandler);
router.patch('/activity-types/:id/active', admin, patchActivityTypeActive as unknown as RequestHandler);
router.put('/coverage-thresholds',     admin, validateSchema(CoverageThresholdSchema), putCoverageThreshold as unknown as RequestHandler);
router.delete('/coverage-thresholds/:departmentId', admin, removeCoverageThreshold as unknown as RequestHandler);

// ── Self schedule (OWN) ──────────────────────────────────────────────────────
router.get('/my-schedule', calView, validateSchema(GridQuerySchema), getMySchedule as unknown as RequestHandler);

// ── Templates (ride on calendar edit) ────────────────────────────────────────
router.get('/templates',          calViewAll, getTemplates as unknown as RequestHandler);
router.get('/templates/:id',      calViewAll, getTemplateById as unknown as RequestHandler);
router.post('/templates',         calEdit, validateSchema(TemplateSchema), postTemplate as unknown as RequestHandler);
router.put('/templates/:id',      calEdit, validateSchema(TemplateSchema), putTemplate as unknown as RequestHandler);
router.patch('/templates/:id/active', calEdit, patchTemplateActive as unknown as RequestHandler);
router.post('/templates/:id/duplicate', calEdit, postDuplicateTemplate as unknown as RequestHandler);

// ── Grid + shifts (viewAll to read, edit to write) ───────────────────────────
router.get('/roster',  calViewAll, getRoster as unknown as RequestHandler);
router.get('/grid',    calViewAll, validateSchema(GridQuerySchema), getGrid as unknown as RequestHandler);
router.put('/shifts',  calEdit, validateSchema(ShiftUpsertSchema), putShift as unknown as RequestHandler);
router.delete('/shifts/:id', calEdit, removeShift as unknown as RequestHandler);
router.post('/apply',  calEdit, validateSchema(ApplyScheduleSchema), postApply as unknown as RequestHandler);
router.post('/publish', calEdit, validateSchema(PublishSchema), postPublish as unknown as RequestHandler);
router.post('/unpublish', calEdit, validateSchema(UnpublishSchema), postUnpublish as unknown as RequestHandler);
router.post('/shifts/:id/unlock', calEdit, postUnlock as unknown as RequestHandler);

// ── Exceptions ───────────────────────────────────────────────────────────────
router.get('/exceptions',        excViewAll, getExceptions as unknown as RequestHandler);
router.post('/exceptions',       excEdit, validateSchema(ExceptionCreateSchema), postException as unknown as RequestHandler);
router.delete('/exceptions/:id', excEdit, removeException as unknown as RequestHandler);
router.post('/exceptions/bulk',  excEdit, validateSchema(BulkExceptionSchema), postBulkException as unknown as RequestHandler);

export default router;
