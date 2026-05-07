/**
 * Submission finalisation.
 *
 * Powers `PUT /api/qa/submissions/:id/finalize`. Loads the submission,
 * validates the source status (only SUBMITTED / DRAFT can be finalised),
 * promotes it to FINALIZED and writes the audit trail entry. Disputed and
 * already-finalised submissions are rejected with explicit error codes so
 * the client can surface the right message.
 *
 * Extracted from the old `controllers/qa.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { QAServiceError } from './qa.types'
import { classifyReviewer } from '../notifications/ReviewerClassifier'
import notificationService from '../notifications/NotificationService'
import logger from '../../config/logger'

export interface FinalizeResult {
  submission_id: number
  previous_status: string
  status: 'FINALIZED'
}

export async function finalizeSubmission(submissionId: number, userId: number): Promise<FinalizeResult> {
  const rows = await prisma.$queryRaw<{ id: number; status: string }[]>(
    Prisma.sql`SELECT id, status FROM submissions WHERE id = ${submissionId} AND status IN ('SUBMITTED', 'DRAFT')`,
  )

  if (rows.length === 0) {
    // Surface the same 404 the legacy controller produced — the in-band
    // status check below only fires if the row is actually loadable.
    throw new QAServiceError(
      'Submission not found or cannot be finalized',
      404,
      'SUBMISSION_NOT_FOUND',
      'NOT_FOUND',
    )
  }

  const existing = rows[0]
  if (existing.status === 'FINALIZED') {
    throw new QAServiceError('Submission is already finalized', 400, 'ALREADY_FINALIZED', 'BAD_REQUEST')
  }
  if (existing.status === 'DISPUTED') {
    throw new QAServiceError('Cannot finalize a disputed submission', 400, 'DISPUTED_SUBMISSION', 'BAD_REQUEST')
  }

  await prisma.submission.update({
    where: { id: submissionId },
    data:  { status: 'FINALIZED' },
  })

  await prisma.auditLog.create({
    data: {
      user_id:     userId,
      action:      'FINALIZED_SUBMISSION',
      target_id:   submissionId,
      target_type: 'SUBMISSION',
      details: JSON.stringify({
        submission_id:    submissionId,
        previous_status:  existing.status,
        new_status:       'FINALIZED',
        action_type:      'ADMIN_FINALIZED',
      }),
    },
  })

  // Fire the appropriate notification. Wrapped — never blocks finalization.
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        form: { select: { id: true, form_name: true, ai_sample_low_confidence_threshold: true } },
      },
    })
    if (submission) {
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
        where: { id: userId }, select: { id: true, username: true, email: true },
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
    }
  } catch (err) {
    logger.warn('[qa.finalize] notify failed (submission still finalized)', err)
  }

  return {
    submission_id:   submissionId,
    previous_status: existing.status,
    status:          'FINALIZED',
  }
}
