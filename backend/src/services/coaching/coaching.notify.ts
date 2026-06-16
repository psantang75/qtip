/**
 * Coaching-session notifications.
 *
 * Maps a coaching session's new status to the matching email template and
 * fires it via NotificationService with the payload its template + the
 * RoleResolver expect (`session`, `csr`, `coach`, and `quiz` for the quiz
 * reminder). Recipients are driven by each template's role tokens:
 *   - `agent`   → the CSR (session.csr_id)
 *   - `creator` → the coach (session.created_by)
 *
 * Statuses without a template (DRAFT, IN_PROCESS, FOLLOW_UP_REQUIRED, CLOSED)
 * are a no-op. Never throws — a mail failure must not block the status change.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import logger from '../../config/logger'
import notificationService from '../notifications/NotificationService'

const STATUS_EVENT: Record<string, string> = {
  SCHEDULED: 'coaching.scheduled',
  AWAITING_CSR_ACTION: 'coaching.awaiting_csr_action',
  QUIZ_PENDING: 'coaching.quiz_pending',
  COMPLETED: 'coaching.completed',
  CANCELED: 'coaching.canceled',
}

export async function notifyCoachingStatus(sessionId: number, status: string): Promise<void> {
  const event = STATUS_EVENT[status]
  if (!event) return

  try {
    const [session] = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT * FROM coaching_sessions WHERE id = ${sessionId}`,
    )
    if (!session) return

    const [csr, coach] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.csr_id }, select: { id: true, username: true } }),
      session.created_by
        ? prisma.user.findUnique({ where: { id: session.created_by }, select: { id: true, username: true } })
        : null,
    ])

    const payload: Record<string, any> = {
      session,
      csr, csrId: session.csr_id,
      coach, coachId: session.created_by ?? null,
      createdBy: session.created_by ?? null,
    }

    if (event === 'coaching.quiz_pending') {
      const [quiz] = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT q.quiz_title AS title FROM coaching_session_quizzes csq
                   JOIN quizzes q ON csq.quiz_id = q.id
                   WHERE csq.coaching_session_id = ${sessionId} LIMIT 1`,
      )
      if (quiz) payload.quiz = quiz
    }

    await notificationService.notify(event, payload, {
      entityType: 'coaching_session',
      entityId: sessionId,
      // CSR recipients are redirected to their /my-coaching/:id view by the
      // frontend route guard; reviewers land on the editor detail page.
      deepLinkPath: `/app/training/coaching/${sessionId}`,
    })
  } catch (err) {
    logger.warn('[coaching.notify] notify failed (status change still applied)', err)
  }
}
