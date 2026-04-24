/**
 * Team-audits list (manager view).
 *
 * GET /api/manager/team-audits
 *
 * The legacy implementation lived inline in `manager.routes.ts`. It uses a
 * two-step approach:
 *   1. Find the manager's CSRs by joining `submission_metadata` against the
 *      managed departments (CSR id is stored as a metadata value, not a FK).
 *   2. Pull every submission for those CSRs and filter / paginate in memory.
 *
 * The in-memory filter approach is preserved verbatim because changing it to
 * SQL-side filtering is a behaviour change (e.g. `form_name` does
 * case-insensitive `includes` matching, dispute status uses bucketed labels).
 */
import prisma from '../../config/prisma'
import { getManagedDepartmentIds } from './manager.access'
import { ManagerServiceError } from './manager.types'

export interface ListAuditsParams {
  userId: number
  page: number
  limit: number
  filters: {
    search?: string
    csr_id?: string
    form_id_search?: string
    form_id?: string
    form_name?: string
    status?: string
    dispute_status?: string
    start_date?: string
    end_date?: string
  }
}

export interface AuditListItem {
  id: number
  csr_id: number
  csr_name: string
  form_id: number
  form_name: string
  total_score: number
  critical_fail_count: number
  score_capped: boolean
  qa_analyst_name: string | null
  submitted_at: Date | string
  status: string
  dispute_id: number | null
  dispute_status: string
  interaction_date: string | null
}

export interface AuditListResult {
  audits: AuditListItem[]
  totalCount: number
  page: number
  limit: number
}

interface CsrMetadataRow {
  csr_id: string
  csr_name: string
}

interface BaseAuditRow {
  id: number
  form_id: number
  total_score: number | string | null
  critical_fail_count: number | string | null
  score_capped: number | boolean | null
  submitted_at: Date | string
  status: string
  form_name: string
  csr_id: string
  qa_analyst_name: string | null
  interaction_date: string | null
}

const DISPUTE_BUCKETS: Record<string, (status: string) => boolean> = {
  None: (s) => s === 'None',
  Pending: (s) => s === 'OPEN',
  Resolved: (s) => ['UPHELD', 'REJECTED', 'ADJUSTED'].includes(s),
}

export async function listManagerTeamAudits(
  params: ListAuditsParams,
): Promise<AuditListResult> {
  const { userId, page, limit, filters } = params
  const offset = (page - 1) * limit

  const departmentIds = await getManagedDepartmentIds(userId)
  if (departmentIds.length === 0) {
    throw new ManagerServiceError(
      'No departments assigned to this manager',
      403,
      'NO_DEPARTMENTS',
    )
  }

  const csrMetadataResult = await prisma.$queryRawUnsafe<CsrMetadataRow[]>(
    `SELECT DISTINCT sm.value as csr_id, u.username as csr_name
     FROM submission_metadata sm
     JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
     JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
     JOIN departments d ON u.department_id = d.id
     WHERE fmf.field_name = 'CSR'
       AND d.id IN (${departmentIds.map(() => '?').join(',')})
       AND u.is_active = 1`,
    ...departmentIds,
  )

  if (csrMetadataResult.length === 0) {
    return { audits: [], totalCount: 0, page, limit }
  }

  const csrMap = csrMetadataResult.reduce<Record<string, string>>((map, csr) => {
    map[csr.csr_id] = csr.csr_name
    return map
  }, {})

  const csrIds = csrMetadataResult.map((csr) => csr.csr_id)

  const allAudits = await prisma.$queryRawUnsafe<BaseAuditRow[]>(
    `SELECT DISTINCT
       s.id, s.form_id, s.total_score, s.critical_fail_count, s.score_capped,
       s.submitted_at, s.status, f.form_name,
       sm.value as csr_id, qa.username as qa_analyst_name,
       (
         SELECT sm2.value
         FROM submission_metadata sm2
         JOIN form_metadata_fields fmf2 ON sm2.field_id = fmf2.id
         WHERE sm2.submission_id = s.id AND fmf2.field_name IN ('Interaction Date', 'Call Date')
         LIMIT 1
       ) as interaction_date
     FROM submissions s
     JOIN forms f ON s.form_id = f.id
     JOIN submission_metadata sm ON sm.submission_id = s.id
     JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
     JOIN users qa ON s.submitted_by = qa.id
     WHERE fmf.field_name = 'CSR' AND sm.value IN (${csrIds.map(() => '?').join(',')})
     ORDER BY s.submitted_at DESC`,
    ...csrIds,
  )

  // Filter in memory to preserve the legacy semantics (case-insensitive
  // form_name LIKE, ISO-date string comparison, etc).
  const effectiveFormId = filters.form_id_search?.trim() || filters.form_id
  let filtered = allAudits

  if (filters.status?.trim()) {
    filtered = filtered.filter((a) => a.status === filters.status)
  }
  if (filters.csr_id?.trim()) {
    filtered = filtered.filter((a) => a.csr_id === filters.csr_id)
  }
  if (filters.form_name?.trim()) {
    const needle = filters.form_name.toLowerCase()
    filtered = filtered.filter((a) => a.form_name?.toLowerCase().includes(needle))
  }
  if (effectiveFormId?.trim()) {
    const formIdInt = parseInt(effectiveFormId, 10)
    filtered = filtered.filter((a) => a.form_id === formIdInt)
  }
  if (filters.start_date?.trim()) {
    filtered = filtered.filter((a) => {
      const date = new Date(a.submitted_at).toISOString().split('T')[0]
      return date >= filters.start_date!
    })
  }
  if (filters.end_date?.trim()) {
    filtered = filtered.filter((a) => {
      const date = new Date(a.submitted_at).toISOString().split('T')[0]
      return date <= filters.end_date!
    })
  }
  if (filters.search?.trim()) {
    const needle = filters.search.trim().toLowerCase()
    filtered = filtered.filter((a) => {
      const csrName = csrMap[a.csr_id] || ''
      return (
        a.form_name.toLowerCase().includes(needle) ||
        a.id.toString().includes(needle) ||
        csrName.toLowerCase().includes(needle)
      )
    })
  }

  // Look up disputes only for the audits that survived filtering, then apply
  // the dispute_status bucket filter on top.
  const auditIds = filtered.map((a) => a.id)
  const disputeMap: Record<number, { dispute_status: string; dispute_id: number | null }> = {}

  if (auditIds.length > 0) {
    const disputeResults = await prisma.$queryRawUnsafe<Array<{
      submission_id: number
      dispute_status: string | null
      dispute_id: number
    }>>(
      `SELECT submission_id, status as dispute_status, id as dispute_id
       FROM disputes
       WHERE submission_id IN (${auditIds.map(() => '?').join(',')})`,
      ...auditIds,
    )

    for (const dispute of disputeResults) {
      disputeMap[dispute.submission_id] = {
        dispute_status: dispute.dispute_status || 'None',
        dispute_id: dispute.dispute_id,
      }
    }
  }

  if (filters.dispute_status?.trim()) {
    const matcher = DISPUTE_BUCKETS[filters.dispute_status]
    if (matcher) {
      filtered = filtered.filter((a) => {
        const dispute = disputeMap[a.id] ?? { dispute_status: 'None', dispute_id: null }
        return matcher(dispute.dispute_status)
      })
    } else {
      filtered = []
    }
  }

  const total = filtered.length
  const paginated = filtered.slice(offset, offset + limit)

  const audits: AuditListItem[] = paginated.map((row) => {
    const dispute = disputeMap[row.id] ?? { dispute_status: 'None', dispute_id: null }
    return {
      id: row.id,
      csr_id: parseInt(row.csr_id, 10),
      csr_name: csrMap[row.csr_id] || 'Unknown',
      form_id: row.form_id,
      form_name: row.form_name,
      total_score: row.total_score == null ? 0 : parseFloat(String(row.total_score)),
      critical_fail_count: Number(row.critical_fail_count ?? 0),
      score_capped: Boolean(row.score_capped),
      qa_analyst_name: row.qa_analyst_name,
      submitted_at: row.submitted_at,
      status: row.status,
      dispute_id: dispute.dispute_id,
      dispute_status: dispute.dispute_status,
      interaction_date: row.interaction_date ?? null,
    }
  })

  return { audits, totalCount: total, page, limit }
}
