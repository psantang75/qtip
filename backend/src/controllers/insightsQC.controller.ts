import { Request, Response } from 'express'
import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import { InsightsPermissionService } from '../services/InsightsPermissionService'
import type { InsightsAccessResult } from '../services/InsightsPermissionService'
import { resolvePeriod } from '../utils/periodUtils'
import type { PeriodRanges } from '../utils/periodUtils'
import { qcKpiService } from '../services/QCKpiService'
import { qcAnalyticsService } from '../services/QCAnalyticsService'
import * as qcData from '../services/QCInsightsData'
import * as qcCoaching from '../services/QCCoachingData'

const permissionService = new InsightsPermissionService()

const ROLE_ID_MAP: Record<string, number> = {
  Admin: 1, QA: 2, CSR: 3, Trainer: 4, Manager: 5, Director: 6,
}

function getRoleId(role: string): number {
  return ROLE_ID_MAP[role] ?? 3
}

async function resolveDeptFilter(
  userId: number,
  access: InsightsAccessResult,
  reqDepts?: string,
): Promise<number[]> {
  if (access.dataScope === 'ALL') {
    if (reqDepts) {
      const ids = reqDepts.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
      return ids
    }
    return []
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT department_id FROM users WHERE id = ?',
    [userId],
  )
  const deptId = rows[0]?.department_id as number | null
  return deptId ? [deptId] : []
}

function periodRanges(req: Request): PeriodRanges {
  return resolvePeriod(
    (req.query.period as string) || 'current_month',
    req.query.start as string | undefined,
    req.query.end as string | undefined,
  )
}

// Generic wrapper — resolves access, dept filter, and period for any QC handler
function qcHandler(
  pageKey: string,
  fn: (deptFilter: number[], ranges: PeriodRanges, req: Request) => Promise<unknown>,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' })
        return
      }
      const access = await permissionService.resolveAccess(
        req.user.user_id, getRoleId(req.user.role), pageKey,
      )
      if (!access.canAccess) {
        res.status(403).json({ error: 'Access denied' })
        return
      }
      const deptFilter = await resolveDeptFilter(
        req.user.user_id, access, req.query.departments as string | undefined,
      )
      const ranges = periodRanges(req)
      const data   = await fn(deptFilter, ranges, req)
      res.json(data)
    } catch (err) {
      console.error(`insightsQC [${pageKey}] error:`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

// ── Shared KPIs & Trends ──────────────────────────────────────────────────────

export const getQCKpis = qcHandler('qc_overview', (deptFilter, ranges) =>
  qcKpiService.getKpiValues(deptFilter, ranges),
)

export const getQCTrends = qcHandler('qc_overview', (deptFilter, ranges, req) => {
  const codes = req.query.kpis
    ? (req.query.kpis as string).split(',')
    : ['avg_qa_score', 'coaching_completion_rate', 'quiz_pass_rate']
  return qcKpiService.getTrends(deptFilter, codes, ranges.current.end)
})

// ── Agents ────────────────────────────────────────────────────────────────────

export const getQCAgents = qcHandler('qc_agents', (deptFilter, ranges) =>
  qcAnalyticsService.getAgents(deptFilter, ranges),
)

export const getQCAgentProfile = qcHandler('qc_agents', (deptFilter, ranges, req) => {
  const userId = parseInt(req.params.userId, 10)
  if (isNaN(userId)) throw new Error('Invalid userId')
  return qcAnalyticsService.getAgentProfile(userId, ranges)
})

// ── Quality deep-dive ─────────────────────────────────────────────────────────

export const getScoreDistribution = qcHandler('qc_quality', (deptFilter, ranges, req) => {
  const formIds = req.query.forms
    ? (req.query.forms as string).split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : []
  return qcData.getScoreDistribution(deptFilter, formIds, ranges)
})

export const getCategoryScores = qcHandler('qc_quality', (deptFilter, ranges, req) => {
  const formId = req.query.form ? parseInt(req.query.form as string, 10) : null
  return qcData.getCategoryScores(deptFilter, formId, ranges)
})

export const getMissedQuestions = qcHandler('qc_quality', (deptFilter, ranges, req) => {
  const formIds = req.query.forms
    ? (req.query.forms as string).split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : []
  return qcData.getMissedQuestions(deptFilter, formIds, ranges)
})

export const getQualityDeptComparison = qcHandler('qc_quality', (_deptFilter, ranges) =>
  qcData.getQualityDeptComparison(ranges),
)

export const getFormScores = qcHandler('qc_quality', (deptFilter, ranges) =>
  qcData.getFormScores(deptFilter, ranges),
)

// ── Coaching ──────────────────────────────────────────────────────────────────

export const getCoachingTopics = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcData.getCoachingTopics(deptFilter, ranges),
)

export const getRepeatOffenders = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcCoaching.getRepeatCoachingAgentsWithTopics(deptFilter, ranges),
)

export const getCoachingTopicAgents = qcHandler('qc_coaching', (deptFilter, ranges, req) => {
  const topic = req.query.topic as string
  if (!topic) throw new Error('topic query parameter is required')
  return qcCoaching.getCoachingTopicAgents(topic, deptFilter, ranges)
})

export const getAgentsFailedQuizzes = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcCoaching.getAgentsFailedQuizzes(deptFilter, ranges),
)

export const getQuizBreakdown = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcData.getQuizBreakdown(deptFilter, ranges),
)

export const getCoachingDeptComparison = qcHandler('qc_coaching', (_deptFilter, ranges) =>
  qcData.getCoachingDeptComparison(ranges),
)

// ── Warnings ──────────────────────────────────────────────────────────────────

export const getWriteUpPipeline = qcHandler('qc_warnings', (deptFilter, ranges) =>
  qcData.getWriteUpPipeline(deptFilter, ranges),
)

export const getActiveWriteUps = qcHandler('qc_warnings', (deptFilter, ranges) =>
  qcData.getActiveWriteUps(deptFilter, ranges),
)

export const getEscalationData = qcHandler('qc_warnings', (deptFilter, ranges) =>
  qcData.getEscalationData(deptFilter, ranges),
)

export const getPolicyViolations = qcHandler('qc_warnings', (deptFilter, ranges) =>
  qcData.getPolicyViolations(deptFilter, ranges),
)

export const getWarningsDeptComparison = qcHandler('qc_warnings', (_deptFilter, ranges) =>
  qcData.getWarningsDeptComparison(ranges),
)
