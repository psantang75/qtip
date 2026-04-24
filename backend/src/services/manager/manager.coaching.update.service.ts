/**
 * Update an existing coaching session.
 *
 * PUT /api/manager/coaching-sessions/:sessionId
 *
 * Performs a dynamic UPDATE so callers can patch a single field without
 * touching the others. Completed sessions can only be reopened (status
 * back to SCHEDULED) — every other field is locked.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { saveCoachingAttachment, type CoachingAttachmentMeta } from './manager.coaching.attachment.service'
import { splitTopicAggregates } from './manager.coaching.query'
import { getCsrRoleId } from './manager.access'
import {
  assertCanCoachCsr,
  assertNotesLength,
  assertValidCoachingType,
  assertValidStatus,
  fetchSessionRow,
  normalizeTopicIds,
  validateTopicIds,
} from './manager.coaching.shared'
import { ManagerServiceError } from './manager.types'

export interface UpdateCoachingParams {
  userId: number
  userRole: string | undefined
  sessionId: number
  body: {
    csr_id?: number | string
    session_date?: string
    topic_ids?: unknown
    coaching_type?: string
    notes?: string
    status?: string
  }
  attachment?: Express.Multer.File
}

interface CurrentSession {
  id: number
  current_status: string
  csr_name: string
}

async function loadCurrentSession(
  userId: number,
  userRole: string | undefined,
  sessionId: number,
): Promise<CurrentSession> {
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

  const rows = await prisma.$queryRawUnsafe<CurrentSession[]>(sql, ...params)
  if (rows.length === 0) {
    throw new ManagerServiceError('Coaching session not found', 404, 'NOT_FOUND')
  }
  return rows[0]
}

/**
 * Completed sessions are immutable except for the act of reopening them
 * (status -> SCHEDULED). Every other field change is rejected.
 */
function assertCompletedEditingRules(
  current: CurrentSession,
  body: UpdateCoachingParams['body'],
  attachment?: Express.Multer.File,
): void {
  if (current.current_status !== 'COMPLETED') return

  const hasOtherFieldUpdates =
    body.csr_id !== undefined ||
    body.session_date !== undefined ||
    body.topic_ids !== undefined ||
    body.coaching_type !== undefined ||
    (body.notes !== undefined && body.notes !== '') ||
    attachment !== undefined

  if (hasOtherFieldUpdates) {
    throw new ManagerServiceError(
      'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)',
      400,
      'COMPLETED_LOCKED',
    )
  }
  if (body.status !== undefined && body.status !== 'SCHEDULED') {
    throw new ManagerServiceError(
      'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)',
      400,
      'COMPLETED_LOCKED',
    )
  }
}

interface UpdateFragments {
  fields: string[]
  values: unknown[]
}

function buildScalarFragments(
  body: UpdateCoachingParams['body'],
  attachmentMeta: CoachingAttachmentMeta | null,
): UpdateFragments {
  const fields: string[] = []
  const values: unknown[] = []

  if (body.csr_id !== undefined) { fields.push('csr_id = ?'); values.push(body.csr_id) }
  if (body.session_date !== undefined) { fields.push('session_date = ?'); values.push(body.session_date) }
  if (body.coaching_type !== undefined) { fields.push('coaching_type = ?'); values.push(body.coaching_type) }
  if (body.notes !== undefined) { fields.push('notes = ?'); values.push(body.notes || null) }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status) }

  if (attachmentMeta) {
    fields.push('attachment_filename = ?'); values.push(attachmentMeta.filename)
    fields.push('attachment_path = ?');     values.push(attachmentMeta.path)
    fields.push('attachment_size = ?');     values.push(attachmentMeta.size)
    fields.push('attachment_mime_type = ?'); values.push(attachmentMeta.mime_type)
  }

  return { fields, values }
}

export async function updateManagerCoachingSession(
  params: UpdateCoachingParams,
): Promise<Record<string, unknown>> {
  const { userId, userRole, sessionId, body, attachment } = params

  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    throw new ManagerServiceError('Invalid session ID', 400, 'INVALID_SESSION_ID')
  }

  const current = await loadCurrentSession(userId, userRole, sessionId)
  assertCompletedEditingRules(current, body, attachment)

  assertValidStatus(body.status)
  assertNotesLength(body.notes)
  if (body.coaching_type !== undefined) assertValidCoachingType(body.coaching_type)

  let validatedTopics: number[] | null = null
  if (body.topic_ids !== undefined) {
    const topicIds = normalizeTopicIds(body.topic_ids)
    validatedTopics = await validateTopicIds(topicIds, { atLeastOne: true })
  }

  if (body.csr_id !== undefined) {
    await assertCanCoachCsr(userId, userRole, Number(body.csr_id))
  }

  const attachmentMeta = attachment ? await saveCoachingAttachment(attachment) : null
  const fragments = buildScalarFragments(body, attachmentMeta)

  if (fragments.fields.length === 0 && validatedTopics === null) {
    throw new ManagerServiceError('No fields to update', 400, 'NOTHING_TO_UPDATE')
  }

  await prisma.$transaction(async (tx) => {
    if (fragments.fields.length > 0) {
      await tx.$executeRawUnsafe(
        `UPDATE coaching_sessions SET ${fragments.fields.join(', ')} WHERE id = ?`,
        ...fragments.values, sessionId,
      )
    }

    if (validatedTopics !== null) {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM coaching_session_topics WHERE coaching_session_id = ${sessionId}
      `)
      for (const topicId of validatedTopics) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO coaching_session_topics (coaching_session_id, topic_id)
          VALUES (${sessionId}, ${topicId})
        `)
      }
    }

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${userId}, 'UPDATE', ${sessionId}, 'coaching_session', ${JSON.stringify(body)})
    `)
  })

  const row = await fetchSessionRow(sessionId)
  const aggregates = splitTopicAggregates({
    topics: row.topics as string | null,
    topic_ids: row.topic_ids as string | null,
  })

  return { ...row, ...aggregates }
}
