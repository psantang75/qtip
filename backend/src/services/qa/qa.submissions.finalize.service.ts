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

  return {
    submission_id:   submissionId,
    previous_status: existing.status,
    status:          'FINALIZED',
  }
}
