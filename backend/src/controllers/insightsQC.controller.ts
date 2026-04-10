import { Request, Response } from 'express'
import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import { InsightsPermissionService } from '../services/InsightsPermissionService'
import type { InsightsAccessResult } from '../services/InsightsPermissionService'
import { resolvePeriod } from '../utils/periodUtils'
import type { PeriodRanges } from '../utils/periodUtils'
import { getInsightsRoleId } from '../utils/insightsRoleMap'
import { qcKpiService } from '../services/QCKpiService'
import { qcAnalyticsService } from '../services/QCAnalyticsService'
import * as qcData from '../services/QCInsightsData'
import * as qcCoaching from '../services/QCCoachingData'

const permissionService = new InsightsPermissionService()

class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

async function resolveDeptFilter(
  userId: number,
  access: InsightsAccessResult,
  reqDepts?: string,
): Promise<number[]> {
  if (access.dataScope === 'ALL') {
    if (reqDepts) {
      const parts = reqDepts.split(',').map(s => s.trim()).filter(Boolean)
      const numericIds = parts.map(Number).filter(n => !isNaN(n) && n > 0)
      if (numericIds.length === parts.length) return numericIds
      // Resolve department names to IDs
      const ph = parts.map(() => '?').join(',')
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM departments WHERE department_name IN (${ph})`,
        parts,
      )
      return rows.map(r => r.id as number)
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
      const roleId = getInsightsRoleId(req.user.role)
      if (roleId === null) {
        res.status(403).json({ error: 'Unknown role' })
        return
      }
      const access = await permissionService.resolveAccess(
        req.user.user_id, roleId, pageKey,
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
      if (err instanceof BadRequestError) {
        res.status(400).json({ error: err.message })
        return
      }
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
  if (isNaN(userId)) throw new BadRequestError('Invalid userId')
  return qcAnalyticsService.getAgentProfile(userId, ranges)
})

// ── Filter options ────────────────────────────────────────────────────────────

export const getFilterOptions = qcHandler('qc_quality', (deptFilter, ranges, req) => {
  const formNames = req.query.forms
    ? (req.query.forms as string).split(',').map(s => s.trim()).filter(Boolean)
    : []
  return qcData.getFilterOptions(deptFilter, formNames, ranges)
})

// ── Quality deep-dive ─────────────────────────────────────────────────────────

function parseFormNames(req: Request): string[] {
  const raw = req.query.forms as string | undefined
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
}

export const getScoreDistribution = qcHandler('qc_quality', (deptFilter, ranges, req) =>
  qcData.getScoreDistribution(deptFilter, parseFormNames(req), ranges),
)

export const getCategoryScores = qcHandler('qc_quality', (deptFilter, ranges, req) =>
  qcData.getCategoryScores(deptFilter, parseFormNames(req), ranges),
)

export const getMissedQuestions = qcHandler('qc_quality', (deptFilter, ranges, req) =>
  qcData.getMissedQuestions(deptFilter, parseFormNames(req), ranges),
)

export const getQualityDeptComparison = qcHandler('qc_quality', (deptFilter, ranges) =>
  qcData.getQualityDeptComparison(deptFilter, ranges),
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
  if (!topic) throw new BadRequestError('topic query parameter is required')
  return qcCoaching.getCoachingTopicAgents(topic, deptFilter, ranges)
})

export const getAgentsFailedQuizzes = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcCoaching.getAgentsFailedQuizzes(deptFilter, ranges),
)

export const getQuizBreakdown = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcCoaching.getQuizBreakdownWithAgents(deptFilter, ranges),
)

export const getSessionsByStatus = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcCoaching.getSessionsByStatus(deptFilter, ranges),
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
