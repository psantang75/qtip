import express, { RequestHandler } from 'express'
import {
  getQCKpis, getQCTrends,
  getQCAgents, getQCAgentProfile,
  getFilterOptions,
  getScoreDistribution, getCategoryScores, getMissedQuestions, getQualityDeptComparison, getFormScores,
  getCoachingTopics, getRepeatOffenders, getCoachingTopicAgents, getSessionsByStatus, getAgentsFailedQuizzes, getQuizBreakdown, getCoachingDeptComparison,
  getWriteUpPipeline, getActiveWriteUps, getEscalationData, getPolicyViolations, getWarningsDeptComparison,
} from '../controllers/insightsQC.controller'

const router = express.Router()

const h = (fn: RequestHandler) => fn as unknown as RequestHandler

router.get('/kpis',                       h(getQCKpis))
router.get('/trends',                     h(getQCTrends))
router.get('/agents',                     h(getQCAgents))
router.get('/agent/:userId',              h(getQCAgentProfile))
router.get('/filter-options',             h(getFilterOptions))
router.get('/quality/score-distribution', h(getScoreDistribution))
router.get('/quality/categories',         h(getCategoryScores))
router.get('/quality/missed-questions',   h(getMissedQuestions))
router.get('/quality/dept-comparison',    h(getQualityDeptComparison))
router.get('/quality/forms',              h(getFormScores))
router.get('/coaching/topics',            h(getCoachingTopics))
router.get('/coaching/repeat-offenders',   h(getRepeatOffenders))
router.get('/coaching/topic-agents',       h(getCoachingTopicAgents))
router.get('/coaching/sessions-by-status',  h(getSessionsByStatus))
router.get('/coaching/failed-quiz-agents', h(getAgentsFailedQuizzes))
router.get('/coaching/quizzes',            h(getQuizBreakdown))
router.get('/coaching/dept-comparison',   h(getCoachingDeptComparison))
router.get('/warnings/pipeline',          h(getWriteUpPipeline))
router.get('/warnings/active',            h(getActiveWriteUps))
router.get('/warnings/escalation',        h(getEscalationData))
router.get('/warnings/policies',          h(getPolicyViolations))
router.get('/warnings/dept-comparison',   h(getWarningsDeptComparison))

export default router
