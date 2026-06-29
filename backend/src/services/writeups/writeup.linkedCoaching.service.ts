/**
 * Writeup → coaching session linkage.
 *
 * Handles creation of a coaching session from inside the writeup form. The
 * row is inserted via raw SQL so the legacy `coaching_sessions.due_date`
 * column (present in 0_init/migration.sql but not modelled in
 * `schema.prisma`) does not block the write — see pre-production review
 * note in `services/coachingSessionsReport.ts` for the same workaround.
 *
 * Split out of `writeup.lifecycle.service.ts` to keep both files under the
 * 300-line cap (pre-production review item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { WriteUpServiceError } from './writeup.types'

/**
 * Resolve a coaching list_items.id. Coaching purpose/format/source are now
 * List-Management-managed FKs. Accepts a numeric id (validated against the
 * given list_type) and falls back to the first active option by display order.
 */
async function resolveCoachingListId(listType: string, value: string | undefined): Promise<number> {
  const id = parseInt(value ?? '')
  if (Number.isInteger(id) && id > 0) {
    const rows = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM list_items WHERE id = ${id} AND list_type = ${listType} AND is_active = 1 LIMIT 1`,
    )
    if (rows.length) return rows[0].id
  }
  const fb = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM list_items WHERE list_type = ${listType} AND is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 1`,
  )
  if (!fb.length) throw new WriteUpServiceError(`Coaching ${listType} list is not configured`, 500, 'WRITEUP_VALIDATION')
  return fb[0].id
}

export interface CreateLinkedCoachingInput {
  csr_id: number | string
  session_date: string
  coaching_purpose?: string
  coaching_format?: string
  notes?: string
  source_type?: string
  topic_names?: string[]
}

/**
 * Create a coaching session that the writeup form can subsequently link to.
 * Topic associations are inserted outside the transaction (best-effort:
 * unknown topics are skipped silently — the session is the contract, the
 * topic tags are decorative).
 */
export async function createLinkedCoachingSession(
  input: CreateLinkedCoachingInput,
  createdBy: number,
): Promise<{ id: number; label: string }> {
  if (!input.csr_id || !input.session_date) {
    throw new WriteUpServiceError('csr_id and session_date are required', 400, 'WRITEUP_VALIDATION')
  }

  const purposeId = await resolveCoachingListId('coaching_purpose', input.coaching_purpose)
  const formatId  = await resolveCoachingListId('coaching_format', input.coaching_format)
  const sourceId  = await resolveCoachingListId('coaching_source', input.source_type)

  const sessionId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO coaching_sessions
        (csr_id, session_date, coaching_purpose, coaching_format, notes, status, source_type, created_by)
      VALUES
        (${parseInt(String(input.csr_id))}, ${input.session_date}, ${purposeId}, ${formatId}, ${input.notes || null}, 'SCHEDULED', ${sourceId}, ${createdBy})
    `)
    const [row] = await tx.$queryRaw<[{ id: bigint }]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`)
    return Number(row.id)
  })

  if (Array.isArray(input.topic_names) && input.topic_names.length > 0) {
    for (const topicName of input.topic_names) {
      const topicRows = await prisma.$queryRaw<[{ id: number }]>(
        Prisma.sql`SELECT id FROM list_items WHERE label = ${topicName} AND list_type = 'training_topic' LIMIT 1`,
      )
      if (topicRows?.[0]?.id) {
        await prisma.$executeRaw(
          Prisma.sql`INSERT IGNORE INTO coaching_session_topics (coaching_session_id, topic_id) VALUES (${sessionId}, ${topicRows[0].id})`,
        )
      }
    }
  }

  const [purposeRow] = await prisma.$queryRaw<{ label: string }[]>(
    Prisma.sql`SELECT label FROM list_items WHERE id = ${purposeId} LIMIT 1`,
  )
  const label = `${purposeRow?.label ?? 'Coaching'} — ${String(input.session_date).slice(0, 10)}`
  return { id: sessionId, label }
}
