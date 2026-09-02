/**
 * Notifications for admin unlocks.
 *
 * Reopening withdraws a score the agent has already seen, so telling them is
 * a transparency requirement, not a nicety — an agent who sees their score
 * change with no explanation has a legitimate grievance. Recipients are
 * driven by the template's role tokens:
 *   - `agent`          -> the CSR the review is about
 *   - `original_qa`    -> the reviewer whose work was reopened
 *   - `direct_manager` -> the CSR's manager
 *   - `self`           -> the disputant (dispute.unlocked only)
 *
 * Never throws. A mail failure must not roll back the unlock.
 */
import prisma from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';
import logger from '../../config/logger';
import notificationService from '../notifications/NotificationService';
import type { UnlockResult } from './unlock.types';
import { unlockReasonLabel } from './unlock.reasons';

export async function notifyRecordUnlocked(
  result: UnlockResult,
  actorId: number,
  reasonCode: string,
  reasonNote: string,
): Promise<void> {
  const event = result.entity_type === 'DISPUTE' ? 'dispute.unlocked' : 'submission.unlocked';

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: result.submission_id },
      select: { id: true, total_score: true, submitted_by: true, form: true, access_mode: true },
    });
    if (!submission) return;
    // Internal-form audits are never seen by the agent, so a reopen has no
    // transparency obligation and fires no notifications. The unlock itself
    // still applies — only the email is suppressed.
    if (submission.access_mode) return;

    const [actor, originalQa] = await Promise.all([
      prisma.user.findUnique({ where: { id: actorId }, select: { id: true, username: true } }),
      prisma.user.findUnique({ where: { id: submission.submitted_by }, select: { id: true, username: true } }),
    ]);

    // The CSR the review is about lives in the `CSR` metadata field, the same
    // place qa.submissions.list.service.ts resolves it from.
    const [csrRow] = await prisma.$queryRaw<Array<{ id: number; username: string }>>(Prisma.sql`
      SELECT u.id, u.username
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
      WHERE sm.submission_id = ${result.submission_id} AND fmf.field_name = 'CSR'
      LIMIT 1
    `);

    const reasonLbl = await unlockReasonLabel(reasonCode);

    let disputantId: number | null = null;
    if (result.entity_type === 'DISPUTE') {
      const dispute = await prisma.dispute.findUnique({
        where: { id: result.entity_id },
        select: { disputed_by: true },
      });
      disputantId = dispute?.disputed_by ?? null;
    }

    await notificationService.notify(
      event,
      {
        form: submission.form ?? null,
        submission: { id: submission.id, total_score: submission.total_score },
        csr: csrRow ?? null,
        csrId: csrRow?.id ?? null,
        disputantId,
        actor,
        originalQa,
        originalQaId: submission.submitted_by,
        unlock: {
          prior_status: result.prior_status,
          new_status: result.new_status,
          reason_code: reasonCode,
          reason_label: reasonLbl,
          reason_note: reasonNote,
          relock_due_at: result.relock_due_at,
          beyond_window: result.beyond_window,
        },
        priorScore: result.prior_score ?? null,
      },
      {
        entityType: result.entity_type === 'DISPUTE' ? 'dispute' : 'submission',
        entityId: result.entity_id,
        deepLinkPath: `/app/quality/submissions/${result.submission_id}`,
      },
    );
  } catch (err) {
    logger.warn('[unlock.notify] notify failed (unlock still applied)', err);
  }
}
