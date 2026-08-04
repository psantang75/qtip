/**
 * Campaign routes, mounted at /api/scheduling/campaigns. Mirrors
 * scheduling.routes: authenticate on all, then page-access gates via
 * authorizePage('sched_campaigns', level). The library (categories/items) is
 * read-open to any campaign viewer and admin-only on writes; schedules and
 * per-day overrides are department-scoped (enforced in the services).
 *
 * Page key sched_campaigns: view (members read their dept), viewAll (managers/
 * directors read across scope), edit (write schedules + overrides + publish).
 *
 * Publishing rides on `edit`, which resolves to Admin and Manager — Directors
 * read drafts across the org but cannot release them.
 */
import { Router, RequestHandler } from 'express';
import { authenticate, authorizePage, authorizeAdmin } from '../middleware/auth';
import { validateSchema } from '../validation/csr.validation';
import {
  CategoryCreateSchema, CategoryUpdateSchema, ItemCreateSchema, ItemUpdateSchema, ReorderSchema,
  ScheduleCreateSchema, ScheduleUpdateSchema, MembershipSchema, MonthQuerySchema, DayCampaignSchema,
  MonthPublishSchema,
} from '../validation/campaign.validation';
import {
  getLibrary, postCategory, putCategory, patchCategoryActive, postReorderCategories,
  postItem, putItem, patchItemActive, postReorderItems,
  getSchedules, getWritableDepartments, postSchedule, putSchedule, removeSchedule,
  getScheduleMembership, putScheduleMembership, getScheduleMonth, putDayCampaign, putMonthPublish,
} from '../controllers/campaigns';

const router = Router();
router.use(authenticate as unknown as RequestHandler);

const view    = authorizePage('sched_campaigns', 'view')    as unknown as RequestHandler;
const edit    = authorizePage('sched_campaigns', 'edit')    as unknown as RequestHandler;
const admin   = authorizeAdmin as unknown as RequestHandler;

// ── Library (read for any viewer, write admin-only) ──────────────────────────
router.get('/library', view, getLibrary as unknown as RequestHandler);

router.post('/categories',            admin, validateSchema(CategoryCreateSchema), postCategory as unknown as RequestHandler);
router.put('/categories/:id',         admin, validateSchema(CategoryUpdateSchema), putCategory as unknown as RequestHandler);
router.patch('/categories/:id/active', admin, patchCategoryActive as unknown as RequestHandler);
router.post('/categories/reorder',    admin, validateSchema(ReorderSchema), postReorderCategories as unknown as RequestHandler);

router.post('/items',                 admin, validateSchema(ItemCreateSchema), postItem as unknown as RequestHandler);
router.put('/items/:id',              admin, validateSchema(ItemUpdateSchema), putItem as unknown as RequestHandler);
router.patch('/items/:id/active',     admin, patchItemActive as unknown as RequestHandler);
router.post('/items/reorder',         admin, validateSchema(ReorderSchema), postReorderItems as unknown as RequestHandler);

// ── Schedules + membership (department-scoped) ───────────────────────────────
router.get('/departments', edit, getWritableDepartments as unknown as RequestHandler);
router.get('/schedules',   view, getSchedules as unknown as RequestHandler);
router.post('/schedules',  edit, validateSchema(ScheduleCreateSchema), postSchedule as unknown as RequestHandler);
router.put('/schedules/:id',    edit, validateSchema(ScheduleUpdateSchema), putSchedule as unknown as RequestHandler);
router.delete('/schedules/:id', edit, removeSchedule as unknown as RequestHandler);

// ── Publishing (Admin + Manager only — `edit` excludes Director) ─────────────
router.put('/schedules/:id/month/publish', edit, validateSchema(MonthPublishSchema), putMonthPublish as unknown as RequestHandler);

router.get('/schedules/:id/membership', view, getScheduleMembership as unknown as RequestHandler);
router.put('/schedules/:id/membership', edit, validateSchema(MembershipSchema), putScheduleMembership as unknown as RequestHandler);

// ── Month projection + overrides ─────────────────────────────────────────────
router.get('/schedules/:id/month', view, validateSchema(MonthQuerySchema), getScheduleMonth as unknown as RequestHandler);
router.put('/schedules/:id/day',   edit, validateSchema(DayCampaignSchema), putDayCampaign as unknown as RequestHandler);

export default router;
