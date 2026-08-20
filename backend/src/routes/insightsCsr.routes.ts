/**
 * Read-only routes for the "Agent Activity - CSR" Insights section, mounted at
 * /api/insights/csr. All GET, mirroring insightsQC.routes.ts — Insights report
 * routers never write. Recompute and rule edits live on insightsAdmin.routes.ts.
 */
import express, { RequestHandler } from 'express'
import {
  getAttendanceSummary,
  getAttendanceOccurrences,
  getAttendanceCompliance,
  getAttendanceDayOfWeek,
} from '../controllers/insightsCsr.controller'
// Tickets & Tasks reads the same service as its Sales twin, so the handler lives
// with the rest of the Agent Activity fact readers; only the scope differs.
import { getCsrCallActivity, getCsrTicketsTasks, getCsrTicketsPastDue, getCsrTicketsDailyHistory, getCsrTicketsProductivity } from '../controllers/insightsAgentActivity.controller'

const router = express.Router()

const h = (fn: RequestHandler) => fn as unknown as RequestHandler

router.get('/attendance/summary',     h(getAttendanceSummary))
router.get('/attendance/occurrences', h(getAttendanceOccurrences))
router.get('/attendance/compliance',  h(getAttendanceCompliance))
router.get('/attendance/day-of-week', h(getAttendanceDayOfWeek))
router.get('/call',                   h(getCsrCallActivity))
router.get('/tickets',                h(getCsrTicketsTasks))
router.get('/tickets/past-due',       h(getCsrTicketsPastDue))
router.get('/tickets/daily-history',  h(getCsrTicketsDailyHistory))
router.get('/tickets/productivity',   h(getCsrTicketsProductivity))

export default router
