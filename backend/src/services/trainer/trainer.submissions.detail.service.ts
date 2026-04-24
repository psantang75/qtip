/**
 * Detailed view for a single completed submission, trainer surface.
 *
 * Powers `GET /api/trainer/completed/:id`. Loads the submission core
 * row plus four parallel detail readers (metadata / calls / answers /
 * dispute), and optionally appends the form's category+question
 * structure when the caller passes any of `includeScores`,
 * `includeQuestionScores`, or `includeScoreDetails`.
 *
 * Behavior preserved verbatim from the legacy `controllers/
 * trainer.controller.ts` during the pre-production review (item #29):
 *  - 404 envelope is `{ error, message, code }` with code `SUBMISSION_NOT_FOUND`.
 *  - When form-structure load fails the request still succeeds with
 *    the partial response (form structure is best-effort).
 *  - Status filter `('FINALIZED','DISPUTED','SUBMITTED')` matches the list service.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { trainerLogger } from '../TrainerLogger'
import { TrainerServiceError } from './trainer.types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TrainerSubmissionDetailOptions {
  includeScores:         boolean
  includeQuestionScores: boolean
  includeScoreDetails:   boolean
}

export async function getTrainerSubmissionDetail(
  submissionId: number,
  options:      TrainerSubmissionDetailOptions,
  userId?:      number,
): Promise<any> {
  const submissionRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id,
      s.form_id,
      s.submitted_by,
      s.submitted_at,
      s.total_score,
      s.status,
      f.form_name,
      f.version,
      f.interaction_type
    FROM submissions s
    JOIN forms f ON s.form_id = f.id
    WHERE s.id = ${submissionId}
      AND (s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')
  `)

  if (submissionRows.length === 0) {
    throw new TrainerServiceError(
      'Submission not found or not a finalized/disputed submission',
      404,
      'SUBMISSION_NOT_FOUND',
    )
  }

  const submission = submissionRows[0]
  trainerLogger.operation('getSubmissionDetails', userId, {
    submissionId,
    formId: submission.form_id,
    status: 'submission_found',
  })

  const [metadataRows, callsRows, answersRows, disputeRows] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT fmf.field_name, sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE sm.submission_id = ${submissionId}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT c.call_id, c.customer_id, c.call_date, c.duration, c.recording_url, c.transcript
      FROM submission_calls sc
      JOIN calls c ON sc.call_id = c.id
      WHERE sc.submission_id = ${submissionId}
      ORDER BY sc.sort_order ASC
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT sa.question_id, fq.question_text, sa.answer, sa.notes
      FROM submission_answers sa
      JOIN form_questions fq ON sa.question_id = fq.id
      WHERE sa.submission_id = ${submissionId}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT d.id, d.reason, d.status, d.resolution_notes, d.attachment_url
      FROM disputes d
      WHERE d.submission_id = ${submissionId}
    `),
  ])

  const response: any = {
    id:          submission.id,
    form_id:     submission.form_id,
    status:      submission.status,
    total_score: submission.total_score,
    form: {
      id:               submission.form_id,
      form_name:        submission.form_name,
      version:          submission.version,
      interaction_type: submission.interaction_type,
    },
    metadata: metadataRows,
    calls:    callsRows,
    answers:  answersRows,
    dispute:  disputeRows.length > 0 ? disputeRows[0] : null,
  }

  if (options.includeScores || options.includeQuestionScores || options.includeScoreDetails) {
    try {
      trainerLogger.operation('getSubmissionDetails', userId, {
        submissionId,
        formId: submission.form_id,
        status: 'fetching_form_structure',
      })

      const categoriesRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT fc.id, fc.name, fc.weight, fc.sort_order
        FROM form_categories fc
        WHERE fc.form_id = ${submission.form_id}
        ORDER BY fc.sort_order ASC
      `)

      if (categoriesRows.length === 0) {
        trainerLogger.operation('getSubmissionDetails', userId, {
          submissionId,
          formId: submission.form_id,
          status: 'no_categories_found',
        })
        return response
      }

      const questionsRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT
          fq.id, fq.category_id, fq.question_text, fq.question_type, fq.weight,
          fq.is_na_allowed, fq.scale_min, fq.scale_max, fq.yes_value, fq.no_value, fq.na_value, fq.sort_order
        FROM form_questions fq
        JOIN form_categories fc ON fq.category_id = fc.id
        WHERE fc.form_id = ${submission.form_id}
        ORDER BY fc.sort_order ASC, fq.sort_order ASC
      `)

      trainerLogger.operation('getSubmissionDetails', userId, {
        submissionId,
        formId:           submission.form_id,
        status:           'form_structure_loaded',
        categoriesCount:  categoriesRows.length,
        questionsCount:   questionsRows.length,
      })

      response.form = {
        ...response.form,
        categories: categoriesRows.map(category => ({
          ...category,
          questions: questionsRows.filter(q => q.category_id === category.id),
        })),
      }
    } catch (formError) {
      // Best-effort: keep partial response on form-structure failures.
      trainerLogger.operationError('getSubmissionDetails', formError as Error, userId, {
        submissionId,
        formId:  submission.form_id,
        context: 'form_structure_fetch_error',
      })
    }
  }

  return response
}
