/**
 * Cross-filtered dropdown options for the On-Demand Reports UI.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * Returns the values available for the dept / form / agent (and
 * coaching-only topic / status) dropdowns inside the given date
 * range, scoped to managers' departments where applicable.
 *
 * Cross-filtered like `/insights/qc/filter-options` — selecting
 * depts narrows the form list, selecting forms narrows the dept
 * list, etc.
 *
 * The file is organised into three scope-specific helpers so each
 * SQL block is a few dozen lines of focused code instead of a
 * 200-line conditional ladder.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { getCsrRoleId } from '../coachingSessionsReport'
import {
  isManager,
  resolveCsrIds,
  resolveDepartmentIds,
  resolveFormIds,
} from './helpers'
import { COACHING_SESSION_STATUSES } from './coaching.report'
import { getOnDemandReport } from './registry'
import type {
  OnDemandFilterOptions,
  OnDemandReportUser,
} from './types'

interface ResolvedSelection {
  deptIds: number[]
  formIds: number[]
  agentIds: number[]
}

interface FilterOptionsContext {
  reportId: string
  user: OnDemandReportUser
  csrRoleId: number | null
  start_date: string
  end_date: string
  selection: ResolvedSelection
}

/** Date window applied to every submission-scoped query. */
function dateBetween(start: string, end: string): Prisma.Sql {
  return Prisma.sql`s.submitted_at BETWEEN ${start} AND ${`${end} 23:59:59`}`
}

/** Manager-scope clause for the analytics (submissions) flow. */
function managerScopeForSubmissions(user: OnDemandReportUser): Prisma.Sql {
  if (!isManager(user)) return Prisma.sql``
  return Prisma.sql`AND (csr_user.department_id IN (
    SELECT DISTINCT dm.department_id FROM department_managers dm
    WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
  ) OR csr_user.department_id IS NULL)`
}

/** Manager-scope clause for the coaching-sessions flow. */
function managerScopeForCoaching(user: OnDemandReportUser): Prisma.Sql {
  if (!isManager(user)) return Prisma.sql``
  return Prisma.sql`AND u.department_id IN (
    SELECT DISTINCT dm.department_id FROM department_managers dm
    WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
  )`
}

/** Standard FROM/JOIN block for the submissions-based dropdowns. */
const SUBMISSIONS_JOIN = Prisma.sql`
  submissions s
    INNER JOIN forms f ON s.form_id = f.id
    LEFT JOIN (
      SELECT sm.submission_id, sm.value
      FROM submission_metadata sm
      INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
    ) sm ON s.id = sm.submission_id
    LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
    LEFT JOIN departments d ON csr_user.department_id = d.id
`

const STATUS_FILTER = Prisma.sql`AND s.status IN ('SUBMITTED', 'FINALIZED')`

async function getDepartmentOptions(ctx: FilterOptionsContext): Promise<string[]> {
  const { reportId, user, csrRoleId, start_date, end_date, selection } = ctx
  const { formIds, agentIds, deptIds } = selection

  if (reportId === 'coaching-sessions') {
    const agentClause = agentIds.length > 0
      ? Prisma.sql`AND u.id IN (${Prisma.join(agentIds)})`
      : Prisma.sql``
    const rows = await prisma.$queryRaw<{ department_name: string }[]>(Prisma.sql`
      SELECT DISTINCT d.department_name
      FROM coaching_sessions cs
      INNER JOIN users u ON cs.csr_id = u.id
      INNER JOIN departments d ON u.department_id = d.id
      WHERE u.role_id = ${csrRoleId ?? 0}
        AND DATE(cs.session_date) BETWEEN ${start_date} AND ${end_date}
        ${agentClause}
        ${managerScopeForCoaching(user)}
        AND d.department_name IS NOT NULL
      ORDER BY d.department_name
    `)
    return rows.map(r => r.department_name)
  }

  // Analytics flow — narrowed by selected forms + agents.
  void deptIds
  const formClause = formIds.length > 0
    ? Prisma.sql`AND s.form_id IN (${Prisma.join(formIds)})`
    : Prisma.sql``
  const agentClause = agentIds.length > 0
    ? Prisma.sql`AND csr_user.id IN (${Prisma.join(agentIds)})`
    : Prisma.sql``
  const rows = await prisma.$queryRaw<{ department_name: string }[]>(Prisma.sql`
    SELECT DISTINCT d.department_name
    FROM ${SUBMISSIONS_JOIN}
    WHERE ${dateBetween(start_date, end_date)}
      ${STATUS_FILTER}
      ${formClause}
      ${agentClause}
      ${managerScopeForSubmissions(user)}
      AND d.department_name IS NOT NULL
    ORDER BY d.department_name
  `)
  return rows.map(r => r.department_name)
}

async function getFormOptions(ctx: FilterOptionsContext): Promise<string[]> {
  const { user, start_date, end_date, selection } = ctx
  const { deptIds, agentIds } = selection
  const deptClause = deptIds.length > 0
    ? Prisma.sql`AND csr_user.department_id IN (${Prisma.join(deptIds)})`
    : Prisma.sql``
  const agentClause = agentIds.length > 0
    ? Prisma.sql`AND csr_user.id IN (${Prisma.join(agentIds)})`
    : Prisma.sql``
  const rows = await prisma.$queryRaw<{ form_name: string }[]>(Prisma.sql`
    SELECT DISTINCT f.form_name
    FROM ${SUBMISSIONS_JOIN}
    WHERE ${dateBetween(start_date, end_date)}
      ${STATUS_FILTER}
      ${deptClause}
      ${agentClause}
      ${managerScopeForSubmissions(user)}
    ORDER BY f.form_name
  `)
  return rows.map(r => r.form_name)
}

async function getAgentOptions(ctx: FilterOptionsContext): Promise<string[]> {
  const { reportId, user, csrRoleId, start_date, end_date, selection } = ctx
  const { deptIds, formIds } = selection

  if (reportId === 'coaching-sessions') {
    const rows = await prisma.$queryRaw<{ username: string }[]>(Prisma.sql`
      SELECT DISTINCT u.username
      FROM coaching_sessions cs
      INNER JOIN users u ON cs.csr_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role_id = ${csrRoleId ?? 0}
        AND DATE(cs.session_date) BETWEEN ${start_date} AND ${end_date}
        ${managerScopeForCoaching(user)}
      ORDER BY u.username
    `)
    return rows.map(r => r.username)
  }

  const deptClause = deptIds.length > 0
    ? Prisma.sql`AND csr_user.department_id IN (${Prisma.join(deptIds)})`
    : Prisma.sql``
  const formClause = formIds.length > 0
    ? Prisma.sql`AND s.form_id IN (${Prisma.join(formIds)})`
    : Prisma.sql``
  const rows = await prisma.$queryRaw<{ username: string }[]>(Prisma.sql`
    SELECT DISTINCT csr_user.username AS username
    FROM ${SUBMISSIONS_JOIN}
    WHERE ${dateBetween(start_date, end_date)}
      ${STATUS_FILTER}
      ${deptClause}
      ${formClause}
      ${managerScopeForSubmissions(user)}
      AND csr_user.username IS NOT NULL
    ORDER BY csr_user.username
  `)
  return rows.map(r => r.username)
}

async function getCoachingTopicOptions(ctx: FilterOptionsContext): Promise<string[]> {
  const { user, csrRoleId, start_date, end_date, selection } = ctx
  const { agentIds, deptIds } = selection
  const agentClause = agentIds.length > 0
    ? Prisma.sql`AND u.id IN (${Prisma.join(agentIds)})`
    : Prisma.sql``
  const deptClause = deptIds.length > 0
    ? Prisma.sql`AND u.department_id IN (${Prisma.join(deptIds)})`
    : Prisma.sql``
  const rows = await prisma.$queryRaw<{ label: string }[]>(Prisma.sql`
    SELECT DISTINCT li.label
    FROM coaching_sessions cs
    INNER JOIN users u ON cs.csr_id = u.id
    INNER JOIN coaching_session_topics cst ON cst.coaching_session_id = cs.id
    INNER JOIN list_items li ON cst.topic_id = li.id AND li.list_type = 'training_topic'
    WHERE u.role_id = ${csrRoleId ?? 0}
      AND DATE(cs.session_date) BETWEEN ${start_date} AND ${end_date}
      ${agentClause}
      ${deptClause}
      ${managerScopeForCoaching(user)}
    ORDER BY li.label
  `)
  return rows.map(r => r.label)
}

export async function getOnDemandFilterOptions(
  reportId: string,
  user: OnDemandReportUser,
  range: { start_date: string; end_date: string },
  selected: { departments?: string[]; forms?: string[]; agents?: string[] },
): Promise<OnDemandFilterOptions> {
  const report = getOnDemandReport(reportId)
  if (!report) return { departments: [], forms: [], agents: [] }

  const csrRoleId = await getCsrRoleId()
  const [deptIds, formIds, agentIds] = await Promise.all([
    resolveDepartmentIds(selected.departments),
    resolveFormIds(selected.forms),
    resolveCsrIds(selected.agents),
  ])

  const ctx: FilterOptionsContext = {
    reportId,
    user,
    csrRoleId,
    start_date: range.start_date,
    end_date: range.end_date,
    selection: { deptIds, formIds, agentIds },
  }

  const departments = report.supportedFilters.includes('departments')
    ? await getDepartmentOptions(ctx)
    : []
  const forms = report.supportedFilters.includes('forms')
    ? await getFormOptions(ctx)
    : []
  const agents = report.supportedFilters.includes('agents')
    ? await getAgentOptions(ctx)
    : []

  let topics: string[] | undefined
  let statuses: string[] | undefined
  if (reportId === 'coaching-sessions') {
    if (report.supportedFilters.includes('topics')) {
      topics = await getCoachingTopicOptions(ctx)
    }
    if (report.supportedFilters.includes('status')) {
      // Static enum list — every status should always be selectable
      // so users can switch from the default (CLOSED) to any other.
      statuses = [...COACHING_SESSION_STATUSES]
    }
  }

  return { departments, forms, agents, topics, statuses }
}
