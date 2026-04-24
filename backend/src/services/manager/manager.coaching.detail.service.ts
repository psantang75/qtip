/**
 * Single coaching session detail.
 *
 * GET /api/manager/coaching-sessions/:sessionId
 */
import prisma from '../../config/prisma'
import { getCsrRoleId } from './manager.access'
import { splitTopicAggregates } from './manager.coaching.query'
import { ManagerServiceError } from './manager.types'

export interface CoachingDetailParams {
  userId: number
  userRole: string | undefined
  sessionId: number
}

export interface CoachingDetail {
  id: number
  csr_id: number
  csr_name: string
  csr_email: string | null
  csr_department: string | null
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

export async function getManagerCoachingSessionDetails(
  params: CoachingDetailParams,
): Promise<CoachingDetail> {
  if (!Number.isFinite(params.sessionId) || params.sessionId <= 0) {
    throw new ManagerServiceError('Invalid session ID', 400, 'INVALID_SESSION_ID')
  }

  const csrRoleId = await getCsrRoleId()

  let sessionQuery: string
  let queryParams: unknown[]

  if (params.userRole === 'Manager') {
    sessionQuery = `
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, u.email as csr_email,
        d.department_name as csr_department,
        cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size,
        cs.attachment_mime_type, cs.created_at,
        creator.username as created_by_name,
        GROUP_CONCAT(li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
        GROUP_CONCAT(li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      JOIN department_managers dm ON d.id = dm.department_id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
      WHERE cs.id = ?
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
        AND dm.manager_id = ?
        AND dm.is_active = 1
      GROUP BY cs.id`
    queryParams = [params.sessionId, csrRoleId, params.userId]
  } else {
    sessionQuery = `
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, u.email as csr_email,
        d.department_name as csr_department,
        cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size,
        cs.attachment_mime_type, cs.created_at,
        creator.username as created_by_name,
        GROUP_CONCAT(li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
        GROUP_CONCAT(li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
      WHERE cs.id = ?
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
      GROUP BY cs.id`
    queryParams = [params.sessionId, csrRoleId]
  }

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    sessionQuery,
    ...queryParams,
  )

  if (!rows || rows.length === 0) {
    throw new ManagerServiceError(
      'Coaching session not found or you do not have permission to view it',
      404,
      'NOT_FOUND',
    )
  }

  const row = rows[0]
  const aggregates = splitTopicAggregates({
    topics: row.topics as string | null,
    topic_ids: row.topic_ids as string | null,
  })

  return {
    id: Number(row.id),
    csr_id: Number(row.csr_id),
    csr_name: String(row.csr_name),
    csr_email: (row.csr_email as string) ?? null,
    csr_department: (row.csr_department as string) ?? null,
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
}
