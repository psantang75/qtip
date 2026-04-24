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

const COACHING_PURPOSES = ['WEEKLY', 'PERFORMANCE', 'ONBOARDING'] as const
const COACHING_FORMATS  = ['ONE_ON_ONE', 'SIDE_BY_SIDE', 'TEAM_SESSION'] as const
const COACHING_SOURCES  = ['QA_AUDIT', 'MANAGER_OBSERVATION', 'TREND', 'DISPUTE', 'SCHEDULED', 'OTHER'] as const

const PURPOSE_LABELS: Record<string, string> = {
  WEEKLY:      'Weekly Coaching',
  PERFORMANCE: 'Performance Coaching',
  ONBOARDING:  'Onboarding Coaching',
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

  const purpose = (COACHING_PURPOSES as readonly string[]).includes(input.coaching_purpose ?? '')
    ? input.coaching_purpose!
    : 'PERFORMANCE'
  const format = (COACHING_FORMATS as readonly string[]).includes(input.coaching_format ?? '')
    ? input.coaching_format!
    : 'ONE_ON_ONE'
  const source = (COACHING_SOURCES as readonly string[]).includes(input.source_type ?? '')
    ? input.source_type!
    : 'OTHER'

  const sessionId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO coaching_sessions
        (csr_id, session_date, coaching_purpose, coaching_format, notes, status, source_type, created_by)
      VALUES
        (${parseInt(String(input.csr_id))}, ${input.session_date}, ${purpose}, ${format}, ${input.notes || null}, 'SCHEDULED', ${source}, ${createdBy})
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

  const label = `${PURPOSE_LABELS[purpose] ?? 'Coaching'} — ${String(input.session_date).slice(0, 10)}`
  return { id: sessionId, label }
}
