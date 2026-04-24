/**
 * Submission detail aggregation.
 *
 * Powers `GET /api/qa/completed/:id`. Loads the submission row, its
 * metadata, calls, answers, latest dispute (with adjusted/previous score),
 * the score breakdown helper, and — when `includeFullForm` is requested —
 * the categories + questions structure.
 *
 * Extracted from the old `controllers/qa.controller.ts` (single 295-line
 * handler) during the pre-production review (item #29). Internal helpers
 * load each chunk so the public method reads top-down.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { dbLogger } from '../../config/logger'
import { QAServiceError } from './qa.types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SubmissionDetail {
  id: number
  form_id: number
  status: string
  total_score: number
  submitted_at: Date
  reviewer_name: string | null
  csr_name: string | null
  critical_fail_count: number
  score_capped: boolean
  critical_cap_percent: number
  form: any
  metadata: any[]
  calls: any[]
  answers: any[]
  dispute: any | null
  scoreBreakdown: any | null
}

/**
 * Fetch a finalised / disputed / submitted submission with all related
 * data. Throws `QAServiceError` 404 when the row is missing or in a
 * non-readable status, and 500 (DATABASE_ERROR) for raw db failures so the
 * controller can preserve the existing two-tier error envelope.
 */
export async function getSubmissionDetail(submissionId: number, includeFullForm: boolean): Promise<SubmissionDetail> {
  let submission: any
  try {
    submission = await loadSubmission(submissionId)
  } catch (error) {
    dbLogger.error(error as Error, undefined, undefined)
    throw new QAServiceError(
      'Database error processing submission details',
      500,
      'QA_SUBMISSION_DB_ERROR',
      'DATABASE_ERROR',
    )
  }

  if (!submission) {
    throw new QAServiceError(
      'Submission not found or not a finalized/disputed submission',
      404,
      'SUBMISSION_NOT_FOUND',
      'NOT_FOUND',
    )
  }

  const [metadata, calls, answers, disputes, scoreBreakdown] = await Promise.all([
    loadMetadata(submissionId),
    loadCalls(submissionId),
    loadAnswers(submissionId),
    loadDispute(submissionId),
    loadScoreBreakdown(submissionId),
  ])

  const result: SubmissionDetail = {
    id:                  submission.id,
    form_id:             submission.form_id,
    status:              submission.status,
    total_score:         submission.total_score,
    submitted_at:        submission.submitted_at,
    reviewer_name:       submission.reviewer_name ?? null,
    csr_name:            submission.csr_name ?? null,
    critical_fail_count: Number(submission.critical_fail_count ?? 0),
    score_capped:        Boolean(submission.score_capped),
    critical_cap_percent: critPctOrDefault(submission.critical_cap_percent),
    form: {
      id:                   submission.form_id,
      form_name:            submission.form_name,
      version:              submission.version,
      user_version:         submission.user_version,
      user_version_date:    submission.user_version_date,
      interaction_type:     submission.interaction_type,
      critical_cap_percent: critPctOrDefault(submission.critical_cap_percent),
    },
    metadata,
    calls,
    answers,
    dispute: disputes[0] ?? null,
    scoreBreakdown,
  }

  if (includeFullForm) {
    const categories = await loadFormStructure(submission.form_id)
    if (categories.length > 0) {
      result.form.categories = categories
    }
  }

  return result
}

// ── internal loaders ─────────────────────────────────────────────────────

const critPctOrDefault = (raw: unknown): number =>
  raw !== null && raw !== undefined ? Number(raw) : 79

async function loadSubmission(submissionId: number): Promise<any | null> {
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id, s.form_id, s.submitted_by, s.submitted_at, s.total_score, s.status,
      s.critical_fail_count, s.score_capped,
      f.form_name, f.version, f.user_version, f.user_version_date,
      f.interaction_type, f.critical_cap_percent,
      reviewer.username AS reviewer_name,
      (
        SELECT u.username
        FROM submission_metadata sm
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
        WHERE sm.submission_id = s.id AND fmf.field_name = 'CSR'
        LIMIT 1
      ) AS csr_name
    FROM submissions s
    JOIN forms f ON s.form_id = f.id
    LEFT JOIN users reviewer ON reviewer.id = s.submitted_by
    WHERE s.id = ${submissionId}
      AND (s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')
  `)
  return rows[0] ?? null
}

async function loadMetadata(submissionId: number): Promise<any[]> {
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT fmf.field_name, fmf.field_type, fmf.sort_order, sm.value
    FROM submission_metadata sm
    JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
    WHERE sm.submission_id = ${submissionId}
    ORDER BY fmf.sort_order ASC
  `)
}

async function loadCalls(submissionId: number): Promise<any[]> {
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c.call_id, c.customer_id, c.call_date, c.duration, c.recording_url, c.transcript
    FROM submission_calls sc
    JOIN calls c ON sc.call_id = c.id
    WHERE sc.submission_id = ${submissionId}
    ORDER BY sc.sort_order ASC
  `)
}

async function loadAnswers(submissionId: number): Promise<any[]> {
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT sa.question_id, fq.question_text, fq.is_critical, sa.answer, sa.notes
    FROM submission_answers sa
    JOIN form_questions fq ON sa.question_id = fq.id
    WHERE sa.submission_id = ${submissionId}
  `)
}

async function loadDispute(submissionId: number): Promise<any[]> {
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      d.id, d.reason, d.status, d.resolution_notes, d.attachment_url,
      d.resolved_by, d.created_at, d.resolved_at,
      dsh_adj.score  AS new_score,
      dsh_prev.score AS previous_score
    FROM disputes d
    LEFT JOIN dispute_score_history dsh_adj  ON dsh_adj.dispute_id  = d.id AND dsh_adj.score_type  = 'ADJUSTED'
    LEFT JOIN dispute_score_history dsh_prev ON dsh_prev.dispute_id = d.id AND dsh_prev.score_type = 'PREVIOUS'
    WHERE d.submission_id = ${submissionId}
    ORDER BY dsh_adj.created_at DESC
    LIMIT 1
  `)
}

async function loadScoreBreakdown(submissionId: number): Promise<any | null> {
  // Dynamic import to avoid loading the heavy scoringUtil module unless a
  // detail request actually fires. Failures are non-fatal — the field is
  // optional in the response.
  try {
    const { getScoreBreakdown } = await import('../../utils/scoringUtil')
    return await getScoreBreakdown(null, submissionId)
  } catch (error) {
    console.error('Error getting score breakdown:', error)
    return null
  }
}

async function loadFormStructure(formId: number): Promise<any[]> {
  const categories = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT fc.id, fc.name, fc.weight, fc.sort_order
    FROM form_categories fc
    WHERE fc.form_id = ${formId}
    ORDER BY fc.sort_order ASC
  `)
  if (categories.length === 0) return []

  const questions = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT fq.id, fq.category_id, fq.question_text, fq.question_type, fq.weight,
      fq.is_na_allowed, fq.scale_min, fq.scale_max, fq.yes_value, fq.no_value,
      fq.na_value, fq.is_critical, fq.sort_order
    FROM form_questions fq
    JOIN form_categories fc ON fq.category_id = fc.id
    WHERE fc.form_id = ${formId}
    ORDER BY fc.sort_order ASC, fq.sort_order ASC
  `)

  return categories.map(category => ({
    ...category,
    questions: questions.filter(q => q.category_id === category.id),
  }))
}
