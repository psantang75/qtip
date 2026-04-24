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
 *   - Inline multer config moved to `middleware/coachingUpload.ts`.
 *   - Duplicate `app.use(authenticate)` removed.
 */
import express, { RequestHandler } from 'express'
import { authenticate, authorizeManager } from '../middleware/auth'
import { coachingUpload } from '../middleware/coachingUpload'
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
  listCoachingHandler,
  exportCoachingHandler,
  coachingDetailHandler,
  createCoachingHandler,
  updateCoachingHandler,
  completeCoachingHandler,
  reopenCoachingHandler,
  downloadCoachingAttachmentHandler,
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
router.get('/team-audits', teamAuditsListHandler as unknown as RequestHandler)
router.get('/team-audits/:id', teamAuditDetailHandler as unknown as RequestHandler)

// Disputes
router.get('/disputes', listDisputesHandler as unknown as RequestHandler)
router.get('/disputes/export', exportDisputesHandler as unknown as RequestHandler)
router.get('/disputes/:disputeId', disputeDetailHandler as unknown as RequestHandler)
router.post('/disputes/:disputeId/resolve', resolveDisputeHandler as unknown as RequestHandler)

// Coaching sessions
router.get('/coaching-sessions', listCoachingHandler as unknown as RequestHandler)
router.get('/coaching-sessions/export', exportCoachingHandler as unknown as RequestHandler)
router.get('/coaching-sessions/:sessionId', coachingDetailHandler as unknown as RequestHandler)
router.get(
  '/coaching-sessions/:sessionId/attachment',
  downloadCoachingAttachmentHandler as unknown as RequestHandler,
)
router.post(
  '/coaching-sessions',
  coachingUpload.single('attachment'),
  createCoachingHandler as unknown as RequestHandler,
)
router.put(
  '/coaching-sessions/:sessionId',
  coachingUpload.single('attachment'),
  updateCoachingHandler as unknown as RequestHandler,
)
router.patch(
  '/coaching-sessions/:sessionId/complete',
  completeCoachingHandler as unknown as RequestHandler,
)
router.patch(
  '/coaching-sessions/:sessionId/reopen',
  reopenCoachingHandler as unknown as RequestHandler,
)

export default router
