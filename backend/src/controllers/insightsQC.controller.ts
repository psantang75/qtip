import { Request, Response } from 'express'
import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import { InsightsPermissionService } from '../services/InsightsPermissionService'
import type { InsightsAccessResult } from '../services/InsightsPermissionService'
import { resolveDeptFilter } from '../services/insightsScope'
import { resolvePeriod } from '../utils/periodUtils'
import type { PeriodRanges } from '../utils/periodUtils'
import { getInsightsRoleId } from '../utils/insightsRoleMap'
import { qcKpiService } from '../services/QCKpiService'
import { qcAnalyticsService } from '../services/QCAnalyticsService'
// QC insight data sources are split by domain. Pre-production review (#68)
// removed the misleadingly named `QCInsightsData` barrel; import the domain
// modules directly so each call site documents which data layer it touches.
import * as qcQuality from '../services/QCQualityData'
import * as qcWarnings from '../services/QCWarningsData'
import * as qcCoaching from '../services/QCCoachingData'

const permissionService = new InsightsPermissionService()

class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
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
      logger.error(`insightsQC [${label}] error:`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

// Page keys for every QC dashboard. Used both for the filter-options
// endpoint and as the access set for shared payloads (KPI tiles, trend
// sparklines) that EVERY QC page consumes. A user with even one QC page
// grant must be able to load these — that's why the gate is "any of".
//
// Declared here (not in the "Filter options" section below) because
// `getQCKpis` and `getQCTrends` reference it before that section is reached.
const QC_PAGE_KEYS = ['qc_overview', 'qc_quality', 'qc_coaching', 'qc_warnings', 'qc_agents']

// ── Shared KPIs & Trends ──────────────────────────────────────────────────────

// `forms` filter is applied by qcKpiService to Quality queries only. Coaching,
// quiz, and discipline KPIs ignore it (those tables have no form association),
// matching the fact that only the Quality + Agent Profile pages expose a Form
// filter in the UI.
//
// KPI tiles and trend sparklines are surfaced on every QC dashboard
// (Overview, Quality, Coaching, Warnings, Agents). Gating only on
// `qc_overview` + `qc_agents` (the original pair) produced false-403s for
// users whose admin had narrowed them to e.g. `qc_coaching` + `qc_warnings`.
// Allow access if the user has access to ANY QC page; per-KPI restriction
// lives in `qcKpiService.getKpiValues` (which already filters by KPI code).
//
// Also serves the Agent Profile drill-down (with ?userId=X). SELF scope is
// forced to the requesting user's own id regardless of the requested id.
export const getQCKpis = qcHandler(QC_PAGE_KEYS, (deptFilter, ranges, req, access) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
  const userId = access.dataScope === 'SELF' ? req.user?.user_id : requestedUserId
  return qcKpiService.getKpiValues(deptFilter, ranges, parseFormNames(req), userId)
})

export const getQCTrends = qcHandler(QC_PAGE_KEYS, (deptFilter, ranges, req, access) => {
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
  const [profile, kpis, trends, formScores, categoryScores, missedQuestions] = await Promise.all([
    qcAnalyticsService.getAgentProfile(userId, ranges),
    qcKpiService.getKpiValues(deptFilter, ranges, formNames, userId),
    qcKpiService.getTrends(deptFilter, trendCodes, ranges.current.end, userId, formNames),
    qcQuality.getFormScores(deptFilter, ranges, userId),
    qcQuality.getCategoryScores(deptFilter, formNames, ranges, userId),
    qcQuality.getMissedQuestions(deptFilter, formNames, ranges, userId),
  ])
  return { profile, kpis, trends, formScores, categoryScores, missedQuestions }
})

// ── Filter options ────────────────────────────────────────────────────────────

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
    const data = await qcQuality.getFilterOptions(deptFilter, formNames, ranges)
    res.json(data)
  } catch (err) {
    logger.error('insightsQC [filter-options] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ── Quality deep-dive ─────────────────────────────────────────────────────────

function parseFormNames(req: Request): string[] {
  const raw = req.query.forms as string | undefined
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
}

// Shared SELF-scope pin used by every QC handler whose data is agent-level.
// A self-scoped grant (e.g. a CSR) is restricted to their own user id so they
// see only their own rows; every other scope passes null and gets the full
// department-scoped view. This mirrors the KPI/agent endpoints above and the
// selfEmployeeKey folding in the Agent Activity + CSR Attendance controllers.
const selfUserId = (access: InsightsAccessResult, req: Request): number | null =>
  access.dataScope === 'SELF' ? req.user?.user_id ?? null : null

export const getScoreDistribution = qcHandler('qc_quality', (deptFilter, ranges, req, access) =>
  qcQuality.getScoreDistribution(deptFilter, parseFormNames(req), ranges, selfUserId(access, req)),
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
  return qcQuality.getCategoryScores(deptFilter, parseFormNames(req), ranges, userId)
})

export const getMissedQuestions = qcHandler(['qc_quality', 'qc_agents'], (deptFilter, ranges, req, access) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : null
  const userId = access.dataScope === 'SELF'
    ? req.user?.user_id ?? null
    : (Number.isFinite(requestedUserId) ? requestedUserId : null)
  return qcQuality.getMissedQuestions(deptFilter, parseFormNames(req), ranges, userId)
})

export const getQualityDeptComparison = qcHandler('qc_quality', (deptFilter, ranges, req, access) =>
  qcQuality.getQualityDeptComparison(deptFilter, ranges, parseFormNames(req), selfUserId(access, req)),
)

// QA Forms Completed — auditor x CSR x form rollup for the Quality page table
// above Department Comparison. Same qc_quality gate + dept scope as the rest
// of the page; honors the dept/form/period filters and SELF scope.
export const getQAFormsCompleted = qcHandler('qc_quality', (deptFilter, ranges, req, access) =>
  qcQuality.getQAFormsCompleted(deptFilter, parseFormNames(req), ranges, selfUserId(access, req)),
)

// QA Forms Below 90% — individual finalized audits scoring under 90, driving
// the Quality page table directly beneath "Average Score by Form". Same
// qc_quality gate + dept scope; honors the dept/form/period filters and SELF scope.
export const getLowScoringAudits = qcHandler('qc_quality', (deptFilter, ranges, req, access) =>
  qcQuality.getLowScoringAudits(deptFilter, parseFormNames(req), ranges, selfUserId(access, req)),
)

// Form scores are also surfaced inside the Agent Profile drill-down on the
// qc_agents page. When ?userId=X is supplied the data is scoped to that
// user's audits; SELF scope forces userId to the requesting user.
export const getFormScores = qcHandler(['qc_quality', 'qc_agents'], (deptFilter, ranges, req, access) => {
  const requestedUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : null
  const userId = access.dataScope === 'SELF'
    ? req.user?.user_id ?? null
    : (Number.isFinite(requestedUserId) ? requestedUserId : null)
  return qcQuality.getFormScores(deptFilter, ranges, userId)
})

// Lazy-loaded per-agent breakdown for a single form. Backs the Quality page's
// "Average Score by Form" expandable rows. Honors current dept and period
// filters via the shared qcHandler wrapper.
export const getFormAgentBreakdown = qcHandler('qc_quality', (deptFilter, ranges, req, access) => {
  const formId = parseInt(req.params.formId, 10)
  if (isNaN(formId)) throw new BadRequestError('Invalid formId')
  return qcQuality.getFormAgentBreakdown(deptFilter, formId, ranges, selfUserId(access, req))
})

// Lazy-loaded per-agent breakdown for a single (form, category). Backs the
// Quality page's "Category Performance" expandable rows. Accepts either an
// explicit categoryId (preferred — comes back on every category row) or a
// fallback (formId + category name) for callers that only have those.
export const getCategoryAgentBreakdown = qcHandler('qc_quality', async (deptFilter, ranges, req, access) => {
  const formId = parseInt(req.query.formId as string, 10)
  if (isNaN(formId)) throw new BadRequestError('Invalid formId')
  let categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string, 10) : NaN
  if (isNaN(categoryId)) {
    const categoryName = (req.query.category as string | undefined)?.trim()
    if (!categoryName) throw new BadRequestError('categoryId or category query parameter is required')
    const found = await qcQuality.findCategoryId(formId, categoryName)
    if (found == null) return []
    categoryId = found
  }
  return qcQuality.getCategoryAgentBreakdown(deptFilter, formId, categoryId, ranges, selfUserId(access, req))
})

// ── Coaching ──────────────────────────────────────────────────────────────────
//
// Same SELF scoping as every other QC page: a self-scoped grant (e.g. a CSR)
// only ever sees their own coaching sessions, quiz results and topics; other
// scopes pass null and get the department-scoped view unchanged.
export const getCoachingTopics = qcHandler('qc_coaching', (deptFilter, ranges, req, access) =>
  qcCoaching.getCoachingTopics(deptFilter, ranges, selfUserId(access, req)),
)

export const getRepeatOffenders = qcHandler('qc_coaching', (deptFilter, ranges, req, access) =>
  qcCoaching.getRepeatCoachingAgentsWithTopics(deptFilter, ranges, selfUserId(access, req)),
)

export const getCoachingTopicAgents = qcHandler('qc_coaching', (deptFilter, ranges, req, access) => {
  const topic = req.query.topic as string
  if (!topic) throw new BadRequestError('topic query parameter is required')
  return qcCoaching.getCoachingTopicAgents(topic, deptFilter, ranges, selfUserId(access, req))
})

export const getAgentsFailedQuizzes = qcHandler('qc_coaching', (deptFilter, ranges, req, access) =>
  qcCoaching.getAgentsFailedQuizzes(deptFilter, ranges, selfUserId(access, req)),
)

export const getQuizBreakdown = qcHandler('qc_coaching', (deptFilter, ranges, req, access) =>
  qcCoaching.getQuizBreakdownWithAgents(deptFilter, ranges, selfUserId(access, req)),
)

export const getSessionsByStatus = qcHandler('qc_coaching', (deptFilter, ranges, req, access) =>
  qcCoaching.getSessionsByStatus(deptFilter, ranges, selfUserId(access, req)),
)

export const getCoachingDeptComparison = qcHandler('qc_coaching', (_deptFilter, ranges, req, access) =>
  qcCoaching.getCoachingDeptComparison(ranges, selfUserId(access, req)),
)

// ── Warnings ──────────────────────────────────────────────────────────────────
//
// Every warnings endpoint honours SELF scope the same way the KPI/agent
// endpoints above do: a self-scoped grant (e.g. a CSR) is pinned to their own
// user id so they see only their own performance warnings, never the org-wide
// view. Non-SELF grants pass `null` and get the full department-scoped data.
export const getWriteUpPipeline = qcHandler('qc_warnings', (deptFilter, ranges, req, access) =>
  qcWarnings.getWriteUpPipeline(deptFilter, ranges, selfUserId(access, req)),
)

export const getActiveWriteUps = qcHandler('qc_warnings', (deptFilter, ranges, req, access) =>
  qcWarnings.getActiveWriteUps(deptFilter, ranges, selfUserId(access, req)),
)

// Combined step-up + agents-on-final payload powering the Escalation Path
// section. Step-Up Counts replaced the old tier-count boxes (which duplicated
// the Type Distribution bars in WarningsPipelineSection).
export const getEscalationData = qcHandler('qc_warnings', async (deptFilter, ranges, req, access) => {
  const forUserId = selfUserId(access, req)
  const [stepUps, agentsOnFinal] = await Promise.all([
    qcWarnings.getStepUpData(deptFilter, ranges, forUserId),
    qcWarnings.getAgentsOnFinalWarning(deptFilter, ranges, forUserId),
  ])
  return { stepUps, agentsOnFinal }
})

export const getRepeatWarningAgents = qcHandler('qc_warnings', (deptFilter, ranges, req, access) =>
  qcWarnings.getRepeatWarningAgents(deptFilter, ranges, selfUserId(access, req)),
)

export const getPolicyViolations = qcHandler('qc_warnings', (deptFilter, ranges, req, access) =>
  qcWarnings.getPolicyViolations(deptFilter, ranges, selfUserId(access, req)),
)

export const getWarningsDeptComparison = qcHandler('qc_warnings', (_deptFilter, ranges, req, access) =>
  qcWarnings.getWarningsDeptComparison(ranges, selfUserId(access, req)),
)

import logger from '../config/logger';