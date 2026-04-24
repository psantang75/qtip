/**
 * Paginated list of coaching sessions visible to the caller.
 *
 * GET /api/manager/coaching-sessions
 */
import prisma from '../../config/prisma'
import {
  buildCoachingWhere,
  splitTopicAggregates,
  type CoachingFilters,
  type CoachingScope,
} from './manager.coaching.query'
import { ManagerServiceError } from './manager.types'

export interface ListCoachingParams extends CoachingScope {
  page: number
  limit: number
  filters: CoachingFilters
}

export interface CoachingListItem {
  id: number
  csr_id: number
  csr_name: string
  session_date: Date | string
  coaching_type: string | null
  notes: string | null
  status: string
  attachment_filename: string | null
  attachment_path: string | null
  attachment_size: number | null
  attachment_mime_type: string | null
  created_at: Date | string
  created_by_name: string | null
  topics: string[]
  topic_ids: number[]
}

export interface CoachingListResult {
  sessions: CoachingListItem[]
  totalCount: number
  page: number
  limit: number
}

export async function listManagerCoachingSessions(
  params: ListCoachingParams,
): Promise<CoachingListResult> {
  if (
    !Number.isFinite(params.limit) ||
    params.limit < 1 ||
    params.limit > 100 ||
    params.page < 1
  ) {
    throw new ManagerServiceError(
      'Invalid pagination parameters',
      400,
      'INVALID_PAGINATION',
    )
  }

  const offset = (params.page - 1) * params.limit
  const where = await buildCoachingWhere(
    { userId: params.userId, userRole: params.userRole },
    params.filters,
  )

  const countResult = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*) as total
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     JOIN departments d ON u.department_id = d.id
     ${where.whereSql}`,
    ...where.params,
  )
  const totalCount = Number(countResult[0]?.total ?? 0)

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       cs.id,
       cs.csr_id,
       u.username as csr_name,
       cs.session_date,
       cs.coaching_type,
       cs.notes,
       cs.status,
       cs.attachment_filename,
       cs.attachment_path,
       cs.attachment_size,
       cs.attachment_mime_type,
       cs.created_at,
       creator.username as created_by_name,
       GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
       GROUP_CONCAT(DISTINCT li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     JOIN departments d ON u.department_id = d.id
     LEFT JOIN users creator ON cs.created_by = creator.id
     LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
     LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
     ${where.whereSql}
     GROUP BY cs.id
     ORDER BY cs.session_date DESC
     LIMIT ${params.limit} OFFSET ${offset}`,
    ...where.params,
  )

  const sessions: CoachingListItem[] = rows.map((row) => {
    const aggregates = splitTopicAggregates({
      topics: row.topics as string | null,
      topic_ids: row.topic_ids as string | null,
    })
    return {
      id: Number(row.id),
      csr_id: Number(row.csr_id),
      csr_name: String(row.csr_name),
      session_date: row.session_date as Date | string,
      coaching_type: (row.coaching_type as string) ?? null,
      notes: (row.notes as string) ?? null,
      status: String(row.status),
      attachment_filename: (row.attachment_filename as string) ?? null,
      attachment_path: (row.attachment_path as string) ?? null,
      attachment_size: row.attachment_size == null ? null : Number(row.attachment_size),
      attachment_mime_type: (row.attachment_mime_type as string) ?? null,
      created_at: row.created_at as Date | string,
      created_by_name: (row.created_by_name as string) ?? null,
      ...aggregates,
    }
  })

  return { sessions, totalCount, page: params.page, limit: params.limit }
}
