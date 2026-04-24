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
  // SELF scope is filtered by user_id at the handler level — leave the
  // dept filter empty so deptClause() produces no SQL.
  if (access.dataScope === 'SELF') return []
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

// Generic wrapper — resolves access, dept filter, and period for any QC handler.
// `access` is forwarded so handlers can react to scope (e.g. SELF agents only
// see their own row).
//
// Pass an array of page keys when an endpoint legitimately serves multiple
// pages (e.g. trend / form-score / category-score data is needed both by the
// QC Quality dashboard AND by the Agent Profile drill-down). The user is
// granted access if ANY of the keys resolve to canAccess; the resolved access
// is the first one that grants — preferring narrower scopes is the caller's
// responsibility.
function qcHandler(
  pageKey: string | string[],
  fn: (deptFilter: number[], ranges: PeriodRanges, req: Request, access: InsightsAccessResult) => Promise<unknown>,
) {
  const keys = Array.isArray(pageKey) ? pageKey : [pageKey]
  const label = keys.join('|')
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
      let access: InsightsAccessResult | null = null
      for (const key of keys) {
        const a = await permissionService.resolveAccess(req.user.user_id, roleId, key)
        if (a.canAccess) { access = a; break }
      }
      if (!access) {
        res.status(403).json({ error: 'Access denied' })
        return
      }
      const deptFilter = await resolveDeptFilter(
        req.user.user_id, access, req.query.departments as string | undefined,
      )
      const ranges = periodRanges(req)
      const data   = await fn(deptFilter, ranges, req, access)
      res.json(data)
    } catch (err) {
      if (err instanceof BadRequestError) {
        res.status(400).json({ error: err.message })
        return
      }
      console.error(`insightsQC [${label}] error:`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

// ── Shared KPIs & Trends ──────────────────────────────────────────────────────

// `forms` filter is applied by qcKpiService to Quality queries only. Coaching,
// quiz, and discipline KPIs ignore it (those tables have no form association),
// matching the fact that only the Quality + Agent Profile pages expose a Form
// filter in the UI.
//
// Also serves the Agent Profile drill-down (with ?userId=X) — users with
// qc_agents access can request KPIs for a single agent. SELF scope is forced
// to the requesting user's own id.
export const getQCKpis = qcHandler(['qc_overview', 'qc_agents'], (deptFilter, ranges, req, access) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
  const userId = access.dataScope === 'SELF' ? req.user?.user_id : requestedUserId
  return qcKpiService.getKpiValues(deptFilter, ranges, parseFormNames(req), userId)
})

// Trends are also used by the Agent Profile drill-down (with ?userId=X), so
// users with qc_agents access can request them too. SELF scope is forced to
// the requesting user's own id.
export const getQCTrends = qcHandler(['qc_overview', 'qc_agents'], (deptFilter, ranges, req, access) => {
  const codes = req.query.kpis
    ? (req.query.kpis as string).split(',')
    : ['avg_qa_score', 'coaching_completion_rate', 'quiz_pass_rate']
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
  const userId = access.dataScope === 'SELF' ? req.user?.user_id : requestedUserId
  return qcKpiService.getTrends(deptFilter, codes, ranges.current.end, userId, parseFormNames(req))
})

// ── Agents ────────────────────────────────────────────────────────────────────

export const getQCAgents = qcHandler('qc_agents', (deptFilter, ranges, req, access) => {
  // SELF scope (e.g. an agent granted qc_agents access) sees only their own row.
  const forUserId = access.dataScope === 'SELF' ? req.user?.user_id ?? null : null
  return qcAnalyticsService.getAgents(deptFilter, ranges, forUserId)
})

export const getQCAgentProfile = qcHandler('qc_agents', (_deptFilter, ranges, req, access) => {
  const userId = parseInt(req.params.userId, 10)
  if (isNaN(userId)) throw new BadRequestError('Invalid userId')
  // SELF scope can only view their own profile.
  if (access.dataScope === 'SELF' && userId !== req.user?.user_id) {
    throw new BadRequestError('You can only view your own profile')
  }
  return qcAnalyticsService.getAgentProfile(userId, ranges)
})

// Combined initial-load endpoint for the Agent Profile page. Bundles the five
// fetches that previously cost five round-trips (profile, KPIs, trends, form
// scores, category scores) into a single Promise.all call. Saves the cold-load
// HTTP overhead while leaving the per-section endpoints intact so filter
// changes still trigger only the affected queries.
export const getQCAgentFull = qcHandler('qc_agents', async (deptFilter, ranges, req, access) => {
  const userId = parseInt(req.params.userId, 10)
  if (isNaN(userId)) throw new BadRequestError('Invalid userId')
  if (access.dataScope === 'SELF' && userId !== req.user?.user_id) {
    throw new BadRequestError('You can only view your own profile')
  }
  const formNames = parseFormNames(req)
  const trendCodes = req.query.kpis
    ? (req.query.kpis as string).split(',')
    : ['avg_qa_score']
  const [profile, kpis, trends, formScores, categoryScores] = await Promise.all([
    qcAnalyticsService.getAgentProfile(userId, ranges),
    qcKpiService.getKpiValues(deptFilter, ranges, formNames, userId),
    qcKpiService.getTrends(deptFilter, trendCodes, ranges.current.end, userId, formNames),
    qcData.getFormScores(deptFilter, ranges, userId),
    qcData.getCategoryScores(deptFilter, formNames, ranges, userId),
  ])
  return { profile, kpis, trends, formScores, categoryScores }
})

// ── Filter options ────────────────────────────────────────────────────────────

// Filter options (dept list + form list) are shared infrastructure used by
// every QC page. Allow access if the user has access to ANY QC page so the
// filter bar still works for users with narrow grants (e.g. SELF on qc_agents).
const QC_PAGE_KEYS = ['qc_overview', 'qc_quality', 'qc_coaching', 'qc_warnings', 'qc_agents']

export const getFilterOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return }
    const roleId = getInsightsRoleId(req.user.role)
    if (roleId === null) { res.status(403).json({ error: 'Unknown role' }); return }

    let access: InsightsAccessResult | null = null
    for (const key of QC_PAGE_KEYS) {
      const a = await permissionService.resolveAccess(req.user.user_id, roleId, key)
      if (a.canAccess) { access = a; break }
    }
    if (!access) { res.status(403).json({ error: 'Access denied' }); return }

    const deptFilter = await resolveDeptFilter(
      req.user.user_id, access, req.query.departments as string | undefined,
    )
    const ranges = periodRanges(req)
    const formNames = req.query.forms
      ? (req.query.forms as string).split(',').map(s => s.trim()).filter(Boolean)
      : []
    const data = await qcData.getFilterOptions(deptFilter, formNames, ranges)
    res.json(data)
  } catch (err) {
    console.error('insightsQC [filter-options] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ── Quality deep-dive ─────────────────────────────────────────────────────────

function parseFormNames(req: Request): string[] {
  const raw = req.query.forms as string | undefined
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
}

export const getScoreDistribution = qcHandler('qc_quality', (deptFilter, ranges, req) =>
  qcData.getScoreDistribution(deptFilter, parseFormNames(req), ranges),
)

// Category & form scores and missed questions are also surfaced inside the
// Agent Profile drill-down on the qc_agents page, so qc_agents access also
// grants them. When a userId filter is requested (Agent Profile drill-down)
// the data is scoped to that user's audits; SELF scope forces the userId to
// the requesting user so a SELF user can't peek at someone else's data.
export const getCategoryScores = qcHandler(['qc_quality', 'qc_agents'], (deptFilter, ranges, req, access) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : null
  const userId = access.dataScope === 'SELF'
    ? req.user?.user_id ?? null
    : (Number.isFinite(requestedUserId) ? requestedUserId : null)
  return qcData.getCategoryScores(deptFilter, parseFormNames(req), ranges, userId)
})

export const getMissedQuestions = qcHandler(['qc_quality', 'qc_agents'], (deptFilter, ranges, req) =>
  qcData.getMissedQuestions(deptFilter, parseFormNames(req), ranges),
)

export const getQualityDeptComparison = qcHandler('qc_quality', (deptFilter, ranges, req) =>
  qcData.getQualityDeptComparison(deptFilter, ranges, parseFormNames(req)),
)

// Form scores are also surfaced inside the Agent Profile drill-down on the
// qc_agents page. When ?userId=X is supplied the data is scoped to that
// user's audits; SELF scope forces userId to the requesting user.
export const getFormScores = qcHandler(['qc_quality', 'qc_agents'], (deptFilter, ranges, req, access) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : null
  const userId = access.dataScope === 'SELF'
    ? req.user?.user_id ?? null
    : (Number.isFinite(requestedUserId) ? requestedUserId : null)
  return qcData.getFormScores(deptFilter, ranges, userId)
})

// Lazy-loaded per-agent breakdown for a single form. Backs the Quality page's
// "Average Score by Form" expandable rows. Honors current dept and period
// filters via the shared qcHandler wrapper.
export const getFormAgentBreakdown = qcHandler('qc_quality', (deptFilter, ranges, req) => {
  const formId = parseInt(req.params.formId, 10)
  if (isNaN(formId)) throw new BadRequestError('Invalid formId')
  return qcData.getFormAgentBreakdown(deptFilter, formId, ranges)
})

// Lazy-loaded per-agent breakdown for a single (form, category). Backs the
// Quality page's "Category Performance" expandable rows. Accepts either an
// explicit categoryId (preferred — comes back on every category row) or a
// fallback (formId + category name) for callers that only have those.
export const getCategoryAgentBreakdown = qcHandler('qc_quality', async (deptFilter, ranges, req) => {
  const formId = parseInt(req.query.formId as string, 10)
  if (isNaN(formId)) throw new BadRequestError('Invalid formId')
  let categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string, 10) : NaN
  if (isNaN(categoryId)) {
    const categoryName = (req.query.category as string | undefined)?.trim()
    if (!categoryName) throw new BadRequestError('categoryId or category query parameter is required')
    const found = await qcData.findCategoryId(formId, categoryName)
    if (found == null) return []
    categoryId = found
  }
  return qcData.getCategoryAgentBreakdown(deptFilter, formId, categoryId, ranges)
})

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

// Combined step-up + agents-on-final payload powering the Escalation Path
// section. Step-Up Counts replaced the old tier-count boxes (which duplicated
// the Type Distribution bars in WarningsPipelineSection).
export const getEscalationData = qcHandler('qc_warnings', async (deptFilter, ranges) => {
  const [stepUps, agentsOnFinal] = await Promise.all([
    qcData.getStepUpData(deptFilter, ranges),
    qcData.getAgentsOnFinalWarning(deptFilter, ranges),
  ])
  return { stepUps, agentsOnFinal }
})

export const getRepeatWarningAgents = qcHandler('qc_warnings', (deptFilter, ranges) =>
  qcData.getRepeatWarningAgents(deptFilter, ranges),
)

export const getPolicyViolations = qcHandler('qc_warnings', (deptFilter, ranges) =>
  qcData.getPolicyViolations(deptFilter, ranges),
)

export const getWarningsDeptComparison = qcHandler('qc_warnings', (_deptFilter, ranges) =>
  qcData.getWarningsDeptComparison(ranges),
)
