/**
 * Resolve an open dispute.
 *
 * POST /api/manager/disputes/:disputeId/resolve
 *
 * Supports three resolution actions:
 *   - `UPHOLD` / `REJECT` (`REJECTED`): record outcome, no score change.
 *   - `ADJUST`: rewrite the submission's `total_score`, optionally rewrite
 *     individual answer values/notes, and append PREVIOUS/ADJUSTED rows to
 *     `dispute_score_history` (PREVIOUS only inserted if absent).
 *   - `ASSIGN_TRAINING`: enrol the disputing CSR into the requested course.
 *
 * After any successful resolution the parent submission is set to FINALIZED
 * and an audit log row is appended.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { getDisputeScoreHistory, recordDisputeScore } from '../../utils/disputeScoreHistory'
import { ManagerServiceError } from './manager.types'

export type ResolutionAction =
  | 'UPHOLD'
  | 'REJECT'
  | 'REJECTED'
  | 'ADJUST'
  | 'ASSIGN_TRAINING'

export interface AnswerEdit {
  question_id: number
  answer?: string
  notes?: string
}

export interface ResolveDisputeParams {
  userId: number
  disputeId: string
  resolution_action: ResolutionAction
  resolution_notes: string
  new_score?: number
  answers?: AnswerEdit[]
  training_id?: number | string
}

export interface ResolveDisputeResult {
  dispute_id: string
  status: 'UPHELD' | 'REJECTED' | 'ADJUSTED'
}

function actionToStatus(action: ResolutionAction): 'UPHELD' | 'REJECTED' | 'ADJUSTED' {
  if (action === 'ADJUST') return 'ADJUSTED'
  if (action === 'REJECT' || action === 'REJECTED') return 'REJECTED'
  return 'UPHELD'
}

export async function resolveManagerDispute(
  params: ResolveDisputeParams,
): Promise<ResolveDisputeResult> {
  const { userId, disputeId, resolution_action, resolution_notes, new_score, answers, training_id } = params

  if (!resolution_action || !resolution_notes) {
    throw new ManagerServiceError(
      'Resolution action and notes are required',
      400,
      'MISSING_FIELDS',
    )
  }

  const disputeResults = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT d.*, s.id as submission_id, s.total_score as current_score
     FROM disputes d
     JOIN submissions s ON d.submission_id = s.id
     WHERE d.id = ? AND d.status = 'OPEN'`,
    disputeId,
  )

  if (disputeResults.length === 0) {
    throw new ManagerServiceError(
      'Dispute not found or not accessible',
      404,
      'NOT_FOUND',
    )
  }

  const dispute = disputeResults[0]
  const finalStatus = actionToStatus(resolution_action)

  if (resolution_action === 'ADJUST' && new_score !== undefined) {
    if (new_score < 0 || new_score > 100) {
      throw new ManagerServiceError(
        'New score must be between 0 and 100',
        400,
        'INVALID_SCORE',
      )
    }
  }

  const submissionId = Number(dispute.submission_id)

  await prisma.$transaction(async (tx) => {
    if (resolution_action === 'ADJUST' && new_score !== undefined) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE submissions SET total_score = ${new_score} WHERE id = ${submissionId}
      `)

      if (Array.isArray(answers)) {
        for (const ans of answers) {
          if (ans.question_id) {
            await tx.$executeRaw(Prisma.sql`
              UPDATE submission_answers
              SET answer = ${ans.answer ?? ''}, notes = ${ans.notes ?? ''}
              WHERE submission_id = ${submissionId} AND question_id = ${ans.question_id}
            `)
          }
        }
      }
    } else if (resolution_action === 'ASSIGN_TRAINING') {
      if (!training_id) {
        throw new ManagerServiceError(
          'Training ID is required for training assignment',
          400,
          'MISSING_TRAINING_ID',
        )
      }

      const csrResults = await tx.$queryRaw<Array<{ csr_id: string | number }>>(Prisma.sql`
        SELECT sm.value as csr_id
        FROM submission_metadata sm
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE sm.submission_id = ${submissionId} AND fmf.field_name = 'CSR'
      `)
      if (csrResults.length === 0) {
        throw new ManagerServiceError(
          'Could not find CSR for training assignment',
          400,
          'MISSING_CSR',
        )
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO enrollments (course_id, user_id, status, progress, created_at)
        VALUES (${training_id}, ${csrResults[0].csr_id}, 'IN_PROGRESS', 0.00, NOW())
      `)
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE disputes
      SET status = ${finalStatus},
          resolved_by = ${userId},
          resolved_at = NOW(),
          resolution_notes = ${resolution_notes}
      WHERE id = ${disputeId}
    `)

    // Once a dispute is closed the parent review is complete.
    await tx.$executeRaw(Prisma.sql`
      UPDATE submissions SET status = 'FINALIZED' WHERE id = ${submissionId}
    `)

    const auditDetails = JSON.stringify({
      dispute_id: disputeId,
      resolution_action,
      new_score: new_score ?? null,
      resolution_notes:
        resolution_notes.substring(0, 100) + (resolution_notes.length > 100 ? '...' : ''),
    })

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${userId}, 'RESOLVE', ${Number(disputeId)}, 'DISPUTE', ${auditDetails})
    `)
  })

  // Record score history outside the transaction to avoid locking the score
  // history table for the whole resolve flow.
  if (resolution_action === 'ADJUST' && new_score !== undefined) {
    const existingHistory = await getDisputeScoreHistory(null, Number(disputeId))
    const hasPrevious = existingHistory.some((h) => h.score_type === 'PREVIOUS')

    if (!hasPrevious) {
      await recordDisputeScore(null, {
        disputeId: Number(disputeId),
        submissionId,
        scoreType: 'PREVIOUS',
        score: Number(dispute.current_score),
        recordedBy: userId,
        notes: 'Original score before dispute resolution',
      })
    }

    await recordDisputeScore(null, {
      disputeId: Number(disputeId),
      submissionId,
      scoreType: 'ADJUSTED',
      score: Number(new_score),
      recordedBy: userId,
      notes: 'Score adjusted during dispute resolution',
    })
  }

  return { dispute_id: disputeId, status: finalStatus }
}
