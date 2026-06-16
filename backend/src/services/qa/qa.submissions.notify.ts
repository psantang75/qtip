/**
 * Submission "review done" notifications.
 *
 * Fires the agent/manager email the moment a QA review is SUBMITTED — that
 * is when the CSR needs to know a review exists. The reviewer kind drives
 * both the template and its cadence:
 *   - human-submitted  → submission.audit_finalized_by_qa  (IMMEDIATE)
 *   - AI-submitted     → submission.audit_finalized_by_ai  (DAILY digest)
 * plus the matching critical_fail_by_* template when any per-question
 * critical-fail answer scored 0.
 *
 * Extracted from finalizeSubmission so submit and (legacy) finalize share
 * one implementation. Never throws — a mail failure must not roll back the
 * submission.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import logger from '../../config/logger'
import { classifyReviewer } from '../notifications/ReviewerClassifier'
import notificationService from '../notifications/NotificationService'

export async function notifySubmissionGraded(
  submissionId: number,
  reviewerUserId: number,
): Promise<void> {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        form: { select: { id: true, form_name: true, ai_sample_low_confidence_threshold: true } },
      },
    })
    if (!submission) return

    const csrIdRaw = await prisma.$queryRaw<Array<{ csr_id: string | number }>>(Prisma.sql`
      SELECT sm.value as csr_id
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE sm.submission_id = ${submissionId} AND fmf.field_name = 'CSR'
    `)
    const csrId = csrIdRaw[0] ? Number(csrIdRaw[0].csr_id) : null
    const csr = csrId
      ? await prisma.user.findUnique({ where: { id: csrId }, select: { id: true, username: true, email: true } })
      : null
    const reviewer = await prisma.user.findUnique({
      where: { id: reviewerUserId }, select: { id: true, username: true, email: true },
    })

    const reviewerKind = classifyReviewer({ submitted_by: submission.submitted_by ?? null })
    const baseEvent = `submission.audit_finalized_by_${reviewerKind}` as const
    const ctx = {
      entityType: 'submission' as const,
      entityId: submissionId,
      deepLinkPath: `/app/quality/submissions/${submissionId}`,
    }
    const payload = {
      form: submission.form,
      submission: {
        id: submission.id,
        total_score: submission.total_score,
        ai_overall_confidence: submission.ai_overall_confidence,
        critical_fail_count: 0,
      },
      csr,
      reviewer,
      reviewerKind,
    }

    await notificationService.notify(baseEvent, payload, ctx)

    // Per-question critical-fail check.
    const criticalCount = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*) as n
      FROM submission_answers sa
      JOIN form_questions fq ON sa.question_id = fq.id
      WHERE sa.submission_id = ${submissionId}
        AND fq.is_critical_fail = 1
        AND sa.score = 0
    `)
    const failed = criticalCount[0] ? Number(criticalCount[0].n) : 0
    if (failed > 0) {
      await notificationService.notify(
        `submission.critical_fail_by_${reviewerKind}` as const,
        { ...payload, submission: { ...payload.submission, critical_fail_count: failed } },
        ctx,
      )
    }
  } catch (err) {
    logger.warn('[qa.submissions.notify] notify failed (submission still saved)', err)
  }
}
