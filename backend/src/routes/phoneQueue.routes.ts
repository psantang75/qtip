/**
 * Phone queue routes, mounted at /api/scheduling/queues.
 *
 * Must be mounted BEFORE /api/scheduling in index.ts — Express matches mount
 * paths in registration order, and the scheduling router would otherwise swallow
 * these paths, exactly as campaign.routes already relies on.
 *
 * Page key sched_queues: view (read coverage for your scope), edit (configure a
 * department and set day overrides). The library itself is admin-only, like
 * campaign categories — a queue is company-wide, so a manager tunes their
 * department's numbers but does not invent queues.
 */
import { Router, RequestHandler } from 'express';
import { authenticate, authorizePage, authorizeAdmin } from '../middleware/auth';
import { validateSchema } from '../validation/csr.validation';
import {
  QueueCreateSchema, QueueUpdateSchema, QueueActiveSchema, QueueReorderSchema,
  DepartmentQueuesSchema, QueuePolicySchema, QueueMembersSchema,
  CoverageQuerySchema, CoverageWeekQuerySchema, OverrideSchema, OverrideClearSchema,
} from '../validation/queue.validation';
import {
  getLibrary, postQueue, putQueue, patchQueueActive, postReorderQueues,
  getDepartments, getDepartmentQueues, putDepartmentQueues,
  getDepartmentPolicy, putDepartmentPolicy,
  getDepartmentRoster, getQueueMembers, putQueueMembers,
  getCoverage, getWeekCoverage, getOverrides, putOverride, putOverrideClear, removeOverride,
} from '../controllers/queues';

const router = Router();
router.use(authenticate as unknown as RequestHandler);

const view  = authorizePage('sched_queues', 'view') as unknown as RequestHandler;
const edit  = authorizePage('sched_queues', 'edit') as unknown as RequestHandler;
const admin = authorizeAdmin as unknown as RequestHandler;

// ── Library (read for any viewer, write admin-only) ──────────────────────────
router.get('/library', view, getLibrary as unknown as RequestHandler);
router.post('/library', admin, validateSchema(QueueCreateSchema), postQueue as unknown as RequestHandler);
router.put('/library/:id', admin, validateSchema(QueueUpdateSchema), putQueue as unknown as RequestHandler);
router.patch('/library/:id/active', admin, validateSchema(QueueActiveSchema), patchQueueActive as unknown as RequestHandler);
router.post('/library/reorder', admin, validateSchema(QueueReorderSchema), postReorderQueues as unknown as RequestHandler);

// ── Department configuration ─────────────────────────────────────────────────
router.get('/departments', view, getDepartments as unknown as RequestHandler);
router.get('/departments/:departmentId/queues', view, getDepartmentQueues as unknown as RequestHandler);
router.put('/departments/:departmentId/queues', edit, validateSchema(DepartmentQueuesSchema), putDepartmentQueues as unknown as RequestHandler);
router.get('/departments/:departmentId/policy', view, getDepartmentPolicy as unknown as RequestHandler);
router.put('/departments/:departmentId/policy', edit, validateSchema(QueuePolicySchema), putDepartmentPolicy as unknown as RequestHandler);
router.get('/departments/:departmentId/roster', view, getDepartmentRoster as unknown as RequestHandler);

// ── Membership ───────────────────────────────────────────────────────────────
router.get('/:queueId/members', view, getQueueMembers as unknown as RequestHandler);
router.put('/:queueId/members', edit, validateSchema(QueueMembersSchema), putQueueMembers as unknown as RequestHandler);

// ── Solved coverage + overrides ──────────────────────────────────────────────
// /coverage/week is registered BEFORE /coverage so Express does not have to
// disambiguate two literal paths that share a prefix.
router.get('/coverage/week', view, validateSchema(CoverageWeekQuerySchema), getWeekCoverage as unknown as RequestHandler);
router.get('/coverage', view, validateSchema(CoverageQuerySchema), getCoverage as unknown as RequestHandler);
router.get('/overrides', view, getOverrides as unknown as RequestHandler);
router.put('/overrides', edit, validateSchema(OverrideSchema), putOverride as unknown as RequestHandler);
router.put('/overrides/clear', edit, validateSchema(OverrideClearSchema), putOverrideClear as unknown as RequestHandler);
router.delete('/overrides/:id', edit, removeOverride as unknown as RequestHandler);

export default router;
