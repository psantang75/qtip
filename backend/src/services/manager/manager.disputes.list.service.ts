/**
 * Paginated list of team disputes for a manager / admin / QA.
 *
 * GET /api/manager/disputes
 *
 * Filtering and scoping logic lives in `manager.disputes.query.ts` so it
 * stays in lock-step with the export endpoint.
 */
import prisma from '../../config/prisma'
import {
  buildDisputeWhere,
  type DisputeFilters,
  type DisputeScope,
} from './manager.disputes.query'

export interface ListDisputesParams extends DisputeScope {
  page: number
  limit: number
  filters: DisputeFilters
}

export interface DisputeListItem {
  dispute_id: number
  submission_id: number
  reason: string | null
  status: string
  created_at: Date | string
  resolved_at: Date | string | null
  resolution_notes: string | null
  total_score: number | null
  previous_score: number | null
  adjusted_score: number | null
  submitted_at: Date | string
  csr_id: number
  csr_name: string
  form_id: number
  form_name: string
  qa_analyst_name: string | null
  interaction_date: string | null
}

export interface DisputeListResult {
  disputes: DisputeListItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const SELECT_LIST = `
  SELECT
    d.id as dispute_id,
    d.submission_id,
    d.reason,
    d.status,
    d.created_at,
    d.resolved_at,
    d.resolution_notes,
    s.total_score,
    (
      SELECT dsh.score
      FROM dispute_score_history dsh
      WHERE dsh.dispute_id = d.id AND dsh.score_type = 'PREVIOUS'
      ORDER BY dsh.created_at ASC, dsh.id ASC
      LIMIT 1
    ) as previous_score,
    (
      SELECT dsh.score
      FROM dispute_score_history dsh
      WHERE dsh.dispute_id = d.id AND dsh.score_type = 'ADJUSTED'
      ORDER BY dsh.created_at DESC, dsh.id DESC
      LIMIT 1
    ) as adjusted_score,
    s.submitted_at,
    csr.id as csr_id,
    csr.username as csr_name,
    f.id as form_id,
    f.form_name,
    qa.username as qa_analyst_name,
    (
      SELECT sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE sm.submission_id = s.id AND fmf.field_name IN ('Interaction Date', 'Call Date')
      LIMIT 1
    ) as interaction_date
  FROM disputes d
  JOIN submissions s ON d.submission_id = s.id
  JOIN forms f ON s.form_id = f.id
  JOIN users csr ON d.disputed_by = csr.id
  JOIN users qa ON s.submitted_by = qa.id
`

export async function listManagerTeamDisputes(
  params: ListDisputesParams,
): Promise<DisputeListResult> {
  const offset = (params.page - 1) * params.limit
  const where = await buildDisputeWhere(
    { userId: params.userId, userRole: params.userRole },
    params.filters,
  )

  if (!where.hasScope) {
    return { disputes: [], total: 0, page: params.page, limit: params.limit, totalPages: 0 }
  }

  const countResults = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*) as total
     FROM disputes d
     JOIN submissions s ON d.submission_id = s.id
     JOIN forms f ON s.form_id = f.id
     JOIN users csr ON d.disputed_by = csr.id
     WHERE ${where.whereSql}`,
    ...where.params,
  )
  const totalCount = Number(countResults[0]?.total ?? 0)

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `${SELECT_LIST}
     WHERE ${where.whereSql}
     ORDER BY d.created_at DESC
     LIMIT ? OFFSET ?`,
    ...where.params, params.limit, offset,
  )

  const disputes: DisputeListItem[] = rows.map((d) => ({
    dispute_id: Number(d.dispute_id),
    submission_id: Number(d.submission_id),
    reason: (d.reason as string) ?? null,
    status: String(d.status),
    created_at: d.created_at as Date | string,
    resolved_at: (d.resolved_at as Date | string | null) ?? null,
    resolution_notes: (d.resolution_notes as string) ?? null,
    total_score: d.total_score == null ? null : Number(d.total_score),
    previous_score: d.previous_score == null ? null : Number(d.previous_score),
    adjusted_score: d.adjusted_score == null ? null : Number(d.adjusted_score),
    submitted_at: d.submitted_at as Date | string,
    csr_id: Number(d.csr_id),
    csr_name: String(d.csr_name),
    form_id: Number(d.form_id),
    form_name: String(d.form_name),
    qa_analyst_name: (d.qa_analyst_name as string) ?? null,
    interaction_date: (d.interaction_date as string) ?? null,
  }))

  return {
    disputes,
    total: totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit),
  }
}
