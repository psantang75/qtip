/**
 * Create a new coaching session.
 *
 * POST /api/manager/coaching-sessions
 *
 * The handler accepts multipart/form-data so callers can attach a file in the
 * same request. All validation lives in `manager.coaching.shared.ts` so the
 * update path stays in lock-step.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { saveCoachingAttachment } from './manager.coaching.attachment.service'
import { splitTopicAggregates } from './manager.coaching.query'
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

export interface CreateCoachingParams {
  managerId: number
  userRole: string | undefined
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

export async function createManagerCoachingSession(
  params: CreateCoachingParams,
): Promise<Record<string, unknown>> {
  const { body, attachment, managerId, userRole } = params
  const topicIds = normalizeTopicIds(body.topic_ids)

  if (!body.csr_id || !body.session_date || !body.coaching_type || !body.status) {
    throw new ManagerServiceError(
      'Missing required fields: csr_id, session_date, coaching_type, status',
      400,
      'MISSING_FIELDS',
    )
  }

  if (!['SCHEDULED', 'COMPLETED'].includes(body.status)) {
    throw new ManagerServiceError(
      'Invalid status. Must be SCHEDULED or COMPLETED',
      400,
      'INVALID_STATUS',
    )
  }
  assertValidStatus(body.status)
  assertValidCoachingType(body.coaching_type)
  assertNotesLength(body.notes)

  const csrId = Number(body.csr_id)
  await assertCanCoachCsr(managerId, userRole, csrId)
  const validatedTopics = await validateTopicIds(topicIds, { atLeastOne: true })

  const attachmentMeta = await saveCoachingAttachment(attachment)

  const newSessionId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO coaching_sessions
        (csr_id, session_date, coaching_type, notes, status,
         attachment_filename, attachment_path, attachment_size, attachment_mime_type,
         created_by)
      VALUES
        (${csrId}, ${body.session_date}, ${body.coaching_type},
         ${body.notes || null}, ${body.status},
         ${attachmentMeta.filename}, ${attachmentMeta.path},
         ${attachmentMeta.size}, ${attachmentMeta.mime_type},
         ${managerId})
    `)

    const insertedRows = await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT LAST_INSERT_ID() as id`,
    )
    const sessionId = Number(insertedRows[0].id)

    for (const topicId of validatedTopics) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO coaching_session_topics (coaching_session_id, topic_id)
        VALUES (${sessionId}, ${topicId})
      `)
    }

    const auditDetails = JSON.stringify({
      csr_id: csrId,
      topic_ids: validatedTopics,
      coaching_type: body.coaching_type,
      status: body.status,
      has_attachment: !!attachment,
    })

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${managerId}, 'CREATE', ${sessionId}, 'coaching_session', ${auditDetails})
    `)

    return sessionId
  })

  const row = await fetchSessionRow(newSessionId)
  const aggregates = splitTopicAggregates({
    topics: row.topics as string | null,
    topic_ids: row.topic_ids as string | null,
  })

  return { ...row, ...aggregates }
}
