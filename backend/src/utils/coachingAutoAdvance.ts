/**
 * Shared helpers for coaching session auto-status transitions.
 *
 * Trigger points:
 *   1. Coach delivers session (IN_PROCESS) → hasCsrRequirements → AWAITING_CSR_ACTION
 *   2. CSR submits action plan / acknowledgment → resolveNextStatus
 *   3. CSR passes a quiz attempt → resolveNextStatus
 */
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

/**
 * Returns true if the session has ANY pending CSR requirement
 * (action plan, acknowledgment, or assigned quizzes).
 */
export async function hasCsrRequirements(sessionId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT require_action_plan, require_acknowledgment
               FROM coaching_sessions WHERE id = ${sessionId}`
  );
  if (!rows.length) return false;
  const s = rows[0];
  if (Boolean(Number(s.require_action_plan)))    return true;
  if (Boolean(Number(s.require_acknowledgment))) return true;

  const qRows = await prisma.$queryRaw<{ cnt: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) as cnt FROM coaching_session_quizzes WHERE coaching_session_id = ${sessionId}`
  );
  return Number(qRows[0]?.cnt ?? 0) > 0;
}

/**
 * Checks whether ALL CSR-required actions are complete.
 *
 * - Reads the current session state from the DB (after any updates have been committed).
 * - Only advances from IN_PROCESS or AWAITING_CSR_ACTION.
 * - Returns 'FOLLOW_UP_REQUIRED' when done + follow_up_date is set.
 * - Returns 'COMPLETED' when done + no follow_up_date.
 * - Returns null if not yet complete or not in an advanceable state.
 */
export async function resolveNextStatus(sessionId: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT require_action_plan, require_acknowledgment,
                      csr_action_plan, csr_acknowledged_at,
                      follow_up_date, status
               FROM coaching_sessions WHERE id = ${sessionId}`
  );
  if (!rows.length) return null;
  const s = rows[0];

  if (!['IN_PROCESS', 'AWAITING_CSR_ACTION'].includes(s.status)) return null;

  // Action plan check
  if (Boolean(Number(s.require_action_plan)) && !s.csr_action_plan) return null;

  // Acknowledgment check
  if (Boolean(Number(s.require_acknowledgment)) && !s.csr_acknowledged_at) return null;

  // All assigned quizzes must have a passing attempt
  const quizzes = await prisma.$queryRaw<{ quiz_id: number }[]>(
    Prisma.sql`SELECT quiz_id FROM coaching_session_quizzes WHERE coaching_session_id = ${sessionId}`
  );
  for (const q of quizzes) {
    const result = await prisma.$queryRaw<{ cnt: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) as cnt FROM quiz_attempts
                 WHERE coaching_session_id = ${sessionId}
                   AND quiz_id = ${q.quiz_id}
                   AND passed = 1`
    );
    if (Number(result[0]?.cnt ?? 0) === 0) return null;
  }

  // All done — route based on follow-up date
  return s.follow_up_date ? 'FOLLOW_UP_REQUIRED' : 'COMPLETED';
}

/**
 * Apply an auto-advance if all CSR actions are complete.
 * Call this AFTER any DB writes (action plan save, quiz insert, etc.).
 * Returns the new status string if advanced, or null if no change.
 */
export async function applyAutoAdvance(sessionId: number, userId: number): Promise<string | null> {
  const nextStatus = await resolveNextStatus(sessionId);
  if (!nextStatus) return null;

  const completedAt = nextStatus === 'COMPLETED' ? new Date() : null;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE coaching_sessions
               SET status = ${nextStatus}, completed_at = COALESCE(completed_at, ${completedAt})
               WHERE id = ${sessionId}`
  );
  await prisma.auditLog.create({
    data: {
      user_id: userId,
      action: 'AUTO_STATUS_ADVANCE',
      target_id: sessionId,
      target_type: 'coaching_session',
      details: JSON.stringify({ to: nextStatus }),
    },
  });
  return nextStatus;
}
