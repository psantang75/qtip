import express, { RequestHandler } from 'express'
import {
  getIRKpis, getIRTrends,
  getIRAgents, getIRAgentProfile, getIRAgentFull,
  getIRFilterOptions,
  getIRScoreDistribution, getIRCategoryScores, getIRMissedQuestions,
  getIRQualityDeptComparison, getIRQAFormsCompleted, getIRFormScores,
  getIRLowScoringAudits, getIRFormAgentBreakdown, getIRCategoryAgentBreakdown,
} from '../controllers/insightsIR.controller'
import { qcCache } from '../middleware/qcCache'

// Internal Research reuses the QC dashboards (Overview / Quality / Agent
// Performance) in INTERNAL scope. Route shape mirrors insightsQC.routes so the
// frontend can swap the base path via InsightsScopeContext with no other change.
const router = express.Router()

const h = (fn: RequestHandler) => fn as unknown as RequestHandler

router.use(qcCache)

router.get('/kpis',                         h(getIRKpis))
router.get('/trends',                       h(getIRTrends))
router.get('/agents',                       h(getIRAgents))
router.get('/agent/:userId',                h(getIRAgentProfile))
router.get('/agent/:userId/full',           h(getIRAgentFull))
router.get('/filter-options',               h(getIRFilterOptions))
router.get('/quality/score-distribution',   h(getIRScoreDistribution))
router.get('/quality/categories',           h(getIRCategoryScores))
router.get('/quality/missed-questions',     h(getIRMissedQuestions))
router.get('/quality/dept-comparison',      h(getIRQualityDeptComparison))
router.get('/quality/qa-forms-completed',   h(getIRQAFormsCompleted))
router.get('/quality/forms',                h(getIRFormScores))
router.get('/quality/low-scores',           h(getIRLowScoringAudits))
router.get('/quality/forms/:formId/agents', h(getIRFormAgentBreakdown))
router.get('/quality/category-agents',      h(getIRCategoryAgentBreakdown))

export default router
