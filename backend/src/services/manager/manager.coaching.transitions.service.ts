/**
 * Status transitions for coaching sessions:
 *   - `completeManagerCoachingSession`: SCHEDULED -> COMPLETED
 *   - `reopenManagerCoachingSession`:   COMPLETED -> SCHEDULED
 *
 * PATCH /api/manager/coaching-sessions/:sessionId/complete
 * PATCH /api/manager/coaching-sessions/:sessionId/reopen
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { getCsrRoleId } from './manager.access'
import { ManagerServiceError } from './manager.types'

export interface TransitionParams {
  userId: number
  userRole: string | undefined
  sessionId: number
}

interface SessionRow {
  id: number
  current_status: string
  csr_name: string
}

async function loadSession(
  userId: number,
  userRole: string | undefined,
  sessionId: number,
): Promise<SessionRow> {
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    throw new ManagerServiceError('Invalid session ID', 400, 'INVALID_SESSION_ID')
  }

  const csrRoleId = await getCsrRoleId()
  const sql = userRole === 'Manager'
    ? `SELECT cs.id, cs.status as current_status, u.username as csr_name
       FROM coaching_sessions cs
       JOIN users u ON cs.csr_id = u.id
       JOIN departments d ON u.department_id = d.id
       JOIN department_managers dm ON d.id = dm.department_id
       WHERE cs.id = ? AND u.role_id = ? AND u.is_active = 1
         AND d.is_active = 1 AND dm.manager_id = ? AND dm.is_active = 1`
    : `SELECT cs.id, cs.status as current_status, u.username as csr_name
       FROM coaching_sessions cs
       JOIN users u ON cs.csr_id = u.id
       JOIN departments d ON u.department_id = d.id
       WHERE cs.id = ? AND u.role_id = ? AND u.is_active = 1 AND d.is_active = 1`

  const params = userRole === 'Manager'
    ? [sessionId, csrRoleId, userId]
    : [sessionId, csrRoleId]

  const rows = await prisma.$queryRawUnsafe<SessionRow[]>(sql, ...params)
  if (rows.length === 0) {
    throw new ManagerServiceError('Coaching session not found', 404, 'NOT_FOUND')
  }
  return rows[0]
}

async function fetchUpdatedSession(sessionId: number): Promise<Record<string, unknown>> {
  // Note: this query intentionally does NOT join the topics table the way the
  // list/detail handlers do — the legacy transition endpoints returned a
  // simpler shape without aggregated topics, and we preserve that contract.
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      cs.id, cs.csr_id, u.username as csr_name,
      cs.session_date, cs.topic, cs.coaching_type, cs.notes, cs.status,
      cs.attachment_filename, cs.attachment_path, cs.attachment_size,
      cs.attachment_mime_type, cs.created_at,
      creator.username as created_by_name
    FROM coaching_sessions cs
    JOIN users u ON cs.csr_id = u.id
    LEFT JOIN users creator ON cs.created_by = creator.id
    WHERE cs.id = ${sessionId}
  `)
  return rows[0] ?? {}
}

export async function completeManagerCoachingSession(
  params: TransitionParams,
): Promise<Record<string, unknown>> {
  const current = await loadSession(params.userId, params.userRole, params.sessionId)

  if (current.current_status === 'COMPLETED') {
    throw new ManagerServiceError(
      'Coaching session is already completed',
      400,
      'ALREADY_COMPLETED',
    )
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE coaching_sessions SET status = 'COMPLETED' WHERE id = ${params.sessionId}
  `)

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
    VALUES (${params.userId}, 'COMPLETE', ${params.sessionId}, 'coaching_session',
            ${JSON.stringify({ csr_name: current.csr_name })})
  `)

  return fetchUpdatedSession(params.sessionId)
}

export async function reopenManagerCoachingSession(
  params: TransitionParams,
): Promise<Record<string, unknown>> {
  const current = await loadSession(params.userId, params.userRole, params.sessionId)

  if (current.current_status !== 'COMPLETED') {
    throw new ManagerServiceError(
      'Can only reopen completed coaching sessions',
      400,
      'NOT_COMPLETED',
    )
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE coaching_sessions SET status = 'SCHEDULED' WHERE id = ${params.sessionId}
  `)

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
    VALUES (${params.userId}, 'REOPEN', ${params.sessionId}, 'coaching_session',
            ${JSON.stringify({ csr_name: current.csr_name })})
  `)

  return fetchUpdatedSession(params.sessionId)
}
