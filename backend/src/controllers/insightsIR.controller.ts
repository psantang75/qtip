/**
 * Internal Research (Internal forms) Insights controller.
 *
 * Reuses the QC Overview / Quality / Agent Performance data layers in INTERNAL
 * scope so management can analyse hidden-capture "Internal" audits that are
 * excluded from every standard surface. Differences from insightsQC.controller:
 *
 *   - accessScope = 'INTERNAL' — every query sees ONLY internal submissions.
 *   - org-flat — department filtering is intentionally ignored (deptFilter = []);
 *     permitted audiences see organisation-wide internal data.
 *   - per-form audience — data is restricted to the Internal forms the requester
 *     is permitted to see (`forms.access_roles`). A user with zero permitted
 *     internal forms gets a 403, which hides the whole section from the nav.
 *
 * Page access is still gated by the DB-backed ie_page rows (ir_overview /
 * ir_quality / ir_agents) via InsightsPermissionService, exactly like QC.
 */
import { Request, Response } from 'express'
import { InsightsPermissionService } from '../services/InsightsPermissionService'
import type { InsightsAccessResult } from '../services/InsightsPermissionService'
import { resolvePeriod } from '../utils/periodUtils'
import type { PeriodRanges } from '../utils/periodUtils'
import { getInsightsRoleId } from '../utils/insightsRoleMap'
import { qcKpiService } from '../services/QCKpiService'
import { qcAnalyticsService } from '../services/QCAnalyticsService'
import * as qcQuality from '../services/QCQualityData'
import { resolvePermittedInternalForms } from '../utils/formScope'
import logger from '../config/logger'

const permissionService = new InsightsPermissionService()

// Every Internal Research page shares the same KPI tiles / filter set, so any
// one of these grants is enough to load the shared payloads (mirrors QC). The
// Overview page was retired (see 20260902190000_remove_ir_overview_insights_page).
const IR_PAGE_KEYS = ['ir_quality', 'ir_agents']

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

interface InternalForms {
  ids: number[]
  names: string[]
}

// Requested ?forms= intersected with the requester's permitted internal forms.
// Empty request => all permitted forms (never "all internal forms"), so a user
// can never widen past their audience grant.
function resolveFormNames(req: Request, permitted: InternalForms): string[] {
  const requested = (req.query.forms as string | undefined)
    ? (req.query.forms as string).split(',').map((s) => s.trim()).filter(Boolean)
    : []
  if (requested.length === 0) return permitted.names
  const allow = new Set(permitted.names)
  return requested.filter((n) => allow.has(n))
}

// Generic wrapper — resolves page access, permitted internal forms (org-flat),
// and period for any Internal Research handler. Mirrors insightsQC.qcHandler but
// forces INTERNAL scope + empty deptFilter and short-circuits to 403 when the
// requester has no permitted internal forms (which hides the section entirely).
function irHandler(
  pageKey: string | string[],
  fn: (
    formNames: string[],
    ranges: PeriodRanges,
    req: Request,
    ctx: { access: InsightsAccessResult; permitted: InternalForms },
  ) => Promise<unknown>,
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
      const permitted = await resolvePermittedInternalForms(req.user.role, req.user.user_id)
      if (permitted.names.length === 0) {
        // No internal forms this user may see — the section does not exist for them.
        res.status(403).json({ error: 'No internal research forms available' })
        return
      }
      const ranges = periodRanges(req)
      const formNames = resolveFormNames(req, permitted)
      const data = await fn(formNames, ranges, req, { access, permitted })
      res.json(data)
    } catch (err) {
      if (err instanceof BadRequestError) {
        res.status(400).json({ error: err.message })
        return
      }
      logger.error(`insightsIR [${label}] error:`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

// ── Shared KPIs & Trends (Overview) ───────────────────────────────────────────

export const getIRKpis = irHandler(IR_PAGE_KEYS, (formNames, ranges, req) => {
  const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
  return qcKpiService.getKpiValues([], ranges, formNames, userId, 'INTERNAL')
})

export const getIRTrends = irHandler(IR_PAGE_KEYS, (formNames, ranges, req) => {
  const codes = req.query.kpis
    ? (req.query.kpis as string).split(',')
    : ['avg_qa_score']
  const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
  return qcKpiService.getTrends([], codes, ranges.current.end, userId, formNames, 'INTERNAL')
})

// ── Filter options ────────────────────────────────────────────────────────────

export const getIRFilterOptions = irHandler(IR_PAGE_KEYS, async (formNames, ranges, _req, ctx) => {
  const base = await qcQuality.getFilterOptions([], [], ranges, 'INTERNAL')
  // Forms are always the requester's permitted internal forms, never the raw
  // set of forms that happen to have internal submissions in the period.
  return { departments: base.departments, forms: ctx.permitted.names }
})

// ── Agents ────────────────────────────────────────────────────────────────────

export const getIRAgents = irHandler('ir_agents', (formNames, ranges) =>
  qcAnalyticsService.getAgents([], ranges, null, 'INTERNAL', formNames),
)

export const getIRAgentProfile = irHandler('ir_agents', (formNames, ranges, req) => {
  const userId = parseInt(req.params.userId, 10)
  if (isNaN(userId)) throw new BadRequestError('Invalid userId')
  return qcAnalyticsService.getAgentProfile(userId, ranges, 'INTERNAL', formNames)
})

export const getIRAgentFull = irHandler('ir_agents', async (formNames, ranges, req) => {
  const userId = parseInt(req.params.userId, 10)
  if (isNaN(userId)) throw new BadRequestError('Invalid userId')
  const trendCodes = req.query.kpis ? (req.query.kpis as string).split(',') : ['avg_qa_score']
  const [profile, kpis, trends, formScores, categoryScores, missedQuestions] = await Promise.all([
    qcAnalyticsService.getAgentProfile(userId, ranges, 'INTERNAL', formNames),
    qcKpiService.getKpiValues([], ranges, formNames, userId, 'INTERNAL'),
    qcKpiService.getTrends([], trendCodes, ranges.current.end, userId, formNames, 'INTERNAL'),
    qcQuality.getFormScores([], ranges, userId, 'INTERNAL', formNames),
    qcQuality.getCategoryScores([], formNames, ranges, userId, 'INTERNAL'),
    qcQuality.getMissedQuestions([], formNames, ranges, userId, 'INTERNAL'),
  ])
  return { profile, kpis, trends, formScores, categoryScores, missedQuestions }
})

// ── Quality deep-dive ─────────────────────────────────────────────────────────

const requestedUserId = (req: Request): number | null => {
  const raw = req.query.userId ? parseInt(req.query.userId as string, 10) : null
  return Number.isFinite(raw) ? raw : null
}

export const getIRScoreDistribution = irHandler('ir_quality', (formNames, ranges) =>
  qcQuality.getScoreDistribution([], formNames, ranges, null, 'INTERNAL'),
)

export const getIRCategoryScores = irHandler(['ir_quality', 'ir_agents'], (formNames, ranges, req) =>
  qcQuality.getCategoryScores([], formNames, ranges, requestedUserId(req), 'INTERNAL'),
)

export const getIRMissedQuestions = irHandler(['ir_quality', 'ir_agents'], (formNames, ranges, req) =>
  qcQuality.getMissedQuestions([], formNames, ranges, requestedUserId(req), 'INTERNAL'),
)

export const getIRQualityDeptComparison = irHandler('ir_quality', (formNames, ranges) =>
  qcQuality.getQualityDeptComparison([], ranges, formNames, null, 'INTERNAL'),
)

export const getIRQAFormsCompleted = irHandler('ir_quality', (formNames, ranges) =>
  qcQuality.getQAFormsCompleted([], formNames, ranges, null, 'INTERNAL'),
)

export const getIRLowScoringAudits = irHandler('ir_quality', (formNames, ranges) =>
  qcQuality.getLowScoringAudits([], formNames, ranges, null, 'INTERNAL'),
)

export const getIRFormScores = irHandler(['ir_quality', 'ir_agents'], (formNames, ranges, req) =>
  qcQuality.getFormScores([], ranges, requestedUserId(req), 'INTERNAL', formNames),
)

export const getIRFormAgentBreakdown = irHandler('ir_quality', (_formNames, ranges, req, ctx) => {
  const formId = parseInt(req.params.formId, 10)
  if (isNaN(formId)) throw new BadRequestError('Invalid formId')
  if (!ctx.permitted.ids.includes(formId)) throw new BadRequestError('Form not permitted')
  return qcQuality.getFormAgentBreakdown([], formId, ranges, null, 'INTERNAL')
})

export const getIRCategoryAgentBreakdown = irHandler('ir_quality', async (_formNames, ranges, req, ctx) => {
  const formId = parseInt(req.query.formId as string, 10)
  if (isNaN(formId)) throw new BadRequestError('Invalid formId')
  if (!ctx.permitted.ids.includes(formId)) throw new BadRequestError('Form not permitted')
  let categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string, 10) : NaN
  if (isNaN(categoryId)) {
    const categoryName = (req.query.category as string | undefined)?.trim()
    if (!categoryName) throw new BadRequestError('categoryId or category query parameter is required')
    const found = await qcQuality.findCategoryId(formId, categoryName)
    if (found == null) return []
    categoryId = found
  }
  return qcQuality.getCategoryAgentBreakdown([], formId, categoryId, ranges, null, 'INTERNAL')
})
