/**
 * "Coaching Sessions" on-demand report.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * Mirrors the legacy `QTIP_CoachingSessions_*.xlsx` workbook by
 * delegating column definitions / row shaping / Excel generation to
 * the existing `services/coachingSessionsReport` helpers — this
 * module is purely the on-demand wrapper around them.
 */

import {
  COACHING_SESSIONS_COLUMNS,
  fetchAllCoachingSessions,
  fetchCoachingSessionsPage,
  formatCoachingSessionRow,
  generateCoachingSessionsXlsx,
  getCsrRoleId,
} from '../coachingSessionsReport'
import {
  isManager,
  resolveCsrIds,
  resolveDepartmentIds,
  resolveTopicIds,
  timestampedFilename,
} from './helpers'
import type {
  OnDemandReport,
  OnDemandReportColumn,
  OnDemandReportFilters,
  OnDemandReportUser,
} from './types'

const coachingColumns: OnDemandReportColumn[] = COACHING_SESSIONS_COLUMNS.map(c => ({
  key: c.key,
  label: c.label,
}))

/** All coaching session statuses in display order. Mirrors the Prisma enum. */
export const COACHING_SESSION_STATUSES = [
  'DRAFT', 'SCHEDULED', 'IN_PROCESS', 'AWAITING_CSR_ACTION',
  'QUIZ_PENDING', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED',
] as const

/**
 * Build the shared filter object passed into the
 * `coachingSessionsReport` helpers. Resolves agent / department /
 * topic NAMES to IDs so the SQL stays consistent regardless of label
 * variations. Multi-agent filtering still has to happen post-fetch
 * since the legacy helper only accepts a single csr_id.
 */
async function buildCoachingFilters(
  filters: OnDemandReportFilters,
  user: OnDemandReportUser,
  csrRoleId: number,
): Promise<{ where: any; csrIds: number[] }> {
  const [csrIds, deptIds, topicIds] = await Promise.all([
    resolveCsrIds(filters.agents),
    resolveDepartmentIds(filters.departments),
    resolveTopicIds(filters.topics),
  ])
  const sessionId = filters.sessionId
    ? Number(String(filters.sessionId).replace(/[^0-9]/g, ''))
    : undefined
  return {
    where: {
      csrRoleId,
      start_date: filters.start_date,
      end_date: filters.end_date,
      managerId: isManager(user) ? user.user_id : undefined,
      csr_id: csrIds.length === 1 ? csrIds[0] : undefined,
      departmentIds: deptIds.length > 0 ? deptIds : undefined,
      topicIds: topicIds.length > 0 ? topicIds : undefined,
      status: filters.status || undefined,
      id: sessionId && Number.isFinite(sessionId) ? sessionId : undefined,
    },
    csrIds,
  }
}

export const coachingSessionsReport: OnDemandReport = {
  id: 'coaching-sessions',
  name: 'Coaching Sessions',
  description:
    'All coaching sessions delivered in the selected date range, including CSR, manager/trainer, ' +
    'topics, status, and notes. Mirrors the Coaching Sessions export workbook.',
  roles: [1, 5],
  columns: coachingColumns,
  supportedFilters: ['period', 'agents', 'departments', 'topics', 'status', 'sessionId'],
  defaultFilters: { status: 'CLOSED' },
  async getRows(filters, user, page) {
    const csrRoleId = await getCsrRoleId()
    if (!csrRoleId) throw new Error('CSR role not found')
    const { where, csrIds } = await buildCoachingFilters(filters, user, csrRoleId)

    const offset = (page.page - 1) * page.pageSize
    const { sessions, totalCount } = await fetchCoachingSessionsPage(
      where,
      { limit: page.pageSize, offset },
    )

    let rows = sessions.map(s => formatCoachingSessionRow(s as any))
    if (csrIds.length > 1) {
      const idSet = new Set(csrIds.map(Number))
      rows = rows.filter(r => idSet.has(Number((r as any).csr_id)))
    }
    return { rows, total: csrIds.length > 1 ? rows.length : totalCount }
  },
  async getXlsx(filters, user) {
    const csrRoleId = await getCsrRoleId()
    if (!csrRoleId) throw new Error('CSR role not found')
    const { where, csrIds } = await buildCoachingFilters(filters, user, csrRoleId)

    let sessions = await fetchAllCoachingSessions(where)
    if (csrIds.length > 1) {
      const idSet = new Set(csrIds.map(Number))
      sessions = sessions.filter(s => idSet.has(Number((s as any).csr_id)))
    }
    const buffer = await generateCoachingSessionsXlsx(sessions)
    return { buffer, filename: timestampedFilename('CoachingSessions') }
  },
}
