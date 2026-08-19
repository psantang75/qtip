/**
 * Manager API routes.
 *
 * All routes require an authenticated user with the Manager role (or another
 * role whitelisted by `authorizeManager` for read-only endpoints).
 *
 * Refactored during the pre-production cleanup (god-files item #29):
 *   - Old `controllers/manager.controller.ts` (~3,500 lines) was decomposed
 *     into the `services/manager/*` and `controllers/manager/*` modules.
 *   - Placeholder/dead routes that returned mock data were removed:
 *       GET  /audits, GET /forms, POST /team/reports, GET /team/goals,
 *       GET  /team/export/:reportId, GET /team/filters,
 *       PUT  /disputes/:disputeId/resolve (frontend uses POST).
 *   - Duplicate `app.use(authenticate)` removed.
 *
 * 2026-06-12: the `/coaching-sessions` route family was removed. It predated
 * the Training coaching module, still referenced the dropped `coaching_type`
 * column, and had no frontend consumers — coaching CRUD lives at
 * `/api/trainer/coaching-sessions`.
 */
import express, { RequestHandler } from 'express'
import { authenticate, authorizeManager, authorizePage } from '../middleware/auth'
import { validateSchema } from '../validation/csr.validation'
import { TeamAuditsListQuerySchema, ManagerDisputesListQuerySchema } from '../validation/listFilters.validation'
import {
  dashboardStatsHandler,
  csrActivityHandler,
  teamCsrsHandler,
  teamAuditsListHandler,
  teamAuditDetailHandler,
  listDisputesHandler,
  exportDisputesHandler,
  disputeDetailHandler,
  resolveDisputeHandler,
} from '../controllers/manager'

const router = express.Router()

router.use(authenticate as unknown as RequestHandler)
router.use(authorizeManager as unknown as RequestHandler)

// Dashboard
router.get('/stats', dashboardStatsHandler as unknown as RequestHandler)
router.get('/dashboard-stats', dashboardStatsHandler as unknown as RequestHandler)
router.get('/csr-activity', csrActivityHandler as unknown as RequestHandler)

// Team
router.get('/team-csrs', teamCsrsHandler as unknown as RequestHandler)

// Team audits
router.get('/team-audits', validateSchema(TeamAuditsListQuerySchema), teamAuditsListHandler as unknown as RequestHandler)
router.get('/team-audits/:id', teamAuditDetailHandler as unknown as RequestHandler)

// Disputes — page-access gates layered on top of `authorizeManager` so that
// flipping `quality_disputes` for a role in the admin Page Access screen
// also blocks the API, not just the UI route. The outer `authorizeManager`
// stays as a coarse role gate (intentionally — keeps CSRs out of /disputes
// here even if `quality_disputes` is mistakenly granted to them; CSR
// dispute history lives at /api/csr/disputes which is the self-scoped
// counterpart).
const disputesRead  = authorizePage('quality_disputes', 'viewAll') as unknown as RequestHandler
const disputesWrite = authorizePage('quality_disputes', 'edit')    as unknown as RequestHandler
router.get('/disputes',                       disputesRead,  validateSchema(ManagerDisputesListQuerySchema), listDisputesHandler  as unknown as RequestHandler)
router.get('/disputes/export',                disputesRead,  exportDisputesHandler as unknown as RequestHandler)
router.get('/disputes/:disputeId',            disputesRead,  disputeDetailHandler  as unknown as RequestHandler)
router.post('/disputes/:disputeId/resolve',   disputesWrite, resolveDisputeHandler as unknown as RequestHandler)

export default router
