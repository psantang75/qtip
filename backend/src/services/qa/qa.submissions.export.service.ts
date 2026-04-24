/**
 * Per-submission CSV export.
 *
 * Powers `GET /api/qa/completed/:id/export`. Builds a row-per-answer CSV
 * via json2csv. This is the only json2csv consumer in the backend — every
 * other export path moved to ExcelJS during the pre-production review
 * (item #24); the QA per-submission CSV stays here because the existing
 * client downloads expect the exact column order below.
 *
 * Extracted from the old `controllers/qa.controller.ts` during the
 * pre-production review (item #29).
 */

import { Parser } from 'json2csv'
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { QAServiceError } from './qa.types'

const EXPORT_FIELDS = [
  'submission_id', 'form_name', 'interaction_type', 'form_version',
  'auditor_name', 'submitted_at', 'total_score', 'status',
  'call_id', 'customer_id', 'call_date', 'csr_name',
  'question_text', 'answer', 'notes',
] as const

export interface SubmissionExportResult {
  csv: string
  filename: string
  rowCount: number
}

/**
 * Resolve the submission, fetch its answer rows, render a CSV string.
 * Throws `QAServiceError` 404 when the submission is missing or in an
 * unexportable status, or when no answers exist for the submission.
 */
export async function buildSubmissionExportCsv(submissionId: number): Promise<SubmissionExportResult> {
  const submissions = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`
      SELECT id FROM submissions
      WHERE id = ${submissionId}
        AND (status = 'FINALIZED' OR status = 'DISPUTED' OR status = 'SUBMITTED')
    `,
  )

  if (submissions.length === 0) {
    throw new QAServiceError(
      'Submission not found or not a finalized/disputed/submitted submission',
      404,
      'SUBMISSION_NOT_FOUND',
      'NOT_FOUND',
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id AS submission_id,
      f.form_name,
      f.interaction_type,
      f.version AS form_version,
      auditor.username AS auditor_name,
      s.submitted_at,
      s.total_score,
      s.status,
      c.call_id,
      c.customer_id,
      c.call_date,
      csr.username AS csr_name,
      fq.question_text,
      sa.answer,
      sa.notes
    FROM submissions s
    JOIN forms f ON s.form_id = f.id
    JOIN users auditor ON s.submitted_by = auditor.id
    LEFT JOIN submission_calls sc ON s.id = sc.submission_id
    LEFT JOIN calls c ON sc.call_id = c.id
    LEFT JOIN users csr ON c.csr_id = csr.id
    JOIN submission_answers sa ON s.id = sa.submission_id
    JOIN form_questions fq ON sa.question_id = fq.id
    WHERE s.id = ${submissionId}
  `)

  if (rows.length === 0) {
    throw new QAServiceError(
      'No answers found for this submission',
      404,
      'NO_ANSWERS_FOUND',
      'NOT_FOUND',
    )
  }

  const csv = new Parser({ fields: [...EXPORT_FIELDS] }).parse(rows)
  return {
    csv,
    filename: `submission-${submissionId}.csv`,
    rowCount: rows.length,
  }
}
