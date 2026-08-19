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
import { attachPhoneSystemRecordings } from '../callRecordingEnrichment'
import { getLastReopenForSubmission, type LastReopen } from '../unlock/unlock.query.service'

 

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
  /** AI Reviewer overall confidence (0..1). NULL for human-authored submissions. */
  ai_overall_confidence: number | null
  /** AI Reviewer side outputs — { timeline, observations }. NULL for human-authored. */
  ai_extras: any | null
  form: any
  metadata: any[]
  calls: any[]
  /** Reference-only — frontend live-fetches header + notes from /api/crm. */
  ticket_tasks: Array<{ kind: 'TICKET' | 'TASK'; external_id: number; sort_order: number }>
  answers: any[]
  dispute: any | null
  scoreBreakdown: any | null
  /** How many times an admin has reopened this review. */
  reopen_count: number
  /** The still-open unlock, when this record is currently reopened. */
  active_unlock: ActiveUnlock | null
  /** The most recent finished reopen, so the record shows it was corrected. */
  last_reopen: LastReopen | null
}

export interface ActiveUnlock {
  id: number
  entity_type: 'SUBMISSION' | 'DISPUTE'
  entity_id: number
  reason_code: string
  reason_note: string
  unlocked_at: Date
  unlocked_by_name: string | null
  relock_due_at: Date
  prior_status: string
  prior_score: number | null
}

export type { LastReopen } from '../unlock/unlock.query.service'

/**
 * Fetch a finalised / disputed / submitted submission (or a review an admin
 * reopened, which sits in DRAFT under an open unlock) with all related data.
 * Throws `QAServiceError` 404 when the row is missing or in a non-readable
 * status, and 500 (DATABASE_ERROR) for raw db failures so the controller can
 * preserve the existing two-tier error envelope.
 */
export async function getSubmissionDetail(
  submissionId: number,
  includeFullForm: boolean,
  restrictToSubmittedBy?: number,
): Promise<SubmissionDetail> {
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

  // QA author self-scope: when restricted, a submission authored by another
  // reviewer returns the same 404 a missing row would — no info leak about
  // whether a submission exists for someone else.
  if (
    !submission ||
    (restrictToSubmittedBy != null && Number(submission.submitted_by) !== restrictToSubmittedBy)
  ) {
    throw new QAServiceError(
      'Submission not found or not a finalized/disputed submission',
      404,
      'SUBMISSION_NOT_FOUND',
      'NOT_FOUND',
    )
  }

  const [metadata, calls, ticket_tasks, answers, disputes, scoreBreakdown, activeUnlock, lastReopen] = await Promise.all([
    loadMetadata(submissionId),
    loadCalls(submissionId),
    loadTicketTasks(submissionId),
    loadAnswers(submissionId),
    loadDispute(submissionId),
    loadScoreBreakdown(submissionId),
    loadActiveUnlock(submissionId),
    getLastReopenForSubmission(submissionId),
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
    ai_overall_confidence:
      submission.ai_overall_confidence == null ? null : Number(submission.ai_overall_confidence),
    ai_extras: submission.ai_extras ?? null,
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
    ticket_tasks,
    answers,
    dispute: disputes[0] ?? null,
    scoreBreakdown,
    reopen_count: Number(submission.reopen_count ?? 0),
    active_unlock: activeUnlock,
    last_reopen: lastReopen,
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
      s.ai_overall_confidence, s.ai_extras, s.reopen_count,
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
      AND (
        s.status IN ('FINALIZED', 'DISPUTED', 'SUBMITTED')
        -- A review an admin reopened sits in DRAFT. It still has to render
        -- here, or the detail page 404s the moment anyone clicks Reopen.
        -- A plain saved DRAFT is opened in the audit editor, not here.
        OR EXISTS (
          SELECT 1 FROM record_unlock ru
          WHERE ru.entity_type = 'SUBMISSION' AND ru.entity_id = s.id AND ru.state = 'OPEN'
        )
      )
  `)
  return rows[0] ?? null
}

/**
 * The still-open unlock for this review, covering both a reopened review and
 * a reopened dispute on it. Drives the banner and the resume-draft CTA.
 */
async function loadActiveUnlock(submissionId: number): Promise<ActiveUnlock | null> {
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT ru.id, ru.entity_type, ru.entity_id, ru.reason_code, ru.reason_note,
           ru.unlocked_at, ru.relock_due_at, ru.prior_status, ru.prior_score,
           actor.username AS unlocked_by_name
    FROM record_unlock ru
    LEFT JOIN users actor ON ru.unlocked_by = actor.id
    WHERE ru.submission_id = ${submissionId} AND ru.state = 'OPEN'
    ORDER BY ru.unlocked_at DESC
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    prior_score: row.prior_score == null ? null : Number(row.prior_score),
  }
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
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c.call_id, c.customer_id, c.call_date, c.duration, c.recording_url, c.transcript
    FROM submission_calls sc
    JOIN calls c ON sc.call_id = c.id
    WHERE sc.submission_id = ${submissionId}
    ORDER BY sc.sort_order ASC
  `)
  return attachPhoneSystemRecordings(rows)
}

/**
 * Reference-only loader for linked CRM tickets/tasks. Returns nothing
 * but {kind, external_id, sort_order} — the full header + notes are
 * live-fetched by the frontend through `/api/crm/{ticket|task}/:id`.
 *
 * `external_id` is BIGINT in MySQL; we cast to string in the query so
 * mysql2 doesn't return a JS BigInt the JSON serializer would choke on,
 * then convert to Number for the response (TaskID/TicketID values fit
 * comfortably in JS's safe-integer range — current max ~1.08M).
 */
async function loadTicketTasks(submissionId: number): Promise<Array<{ kind: 'TICKET' | 'TASK'; external_id: number; sort_order: number }>> {
  const rows = await prisma.$queryRaw<Array<{ kind: 'TICKET' | 'TASK'; external_id: string; sort_order: number }>>(Prisma.sql`
    SELECT kind, CAST(external_id AS CHAR) AS external_id, sort_order
    FROM submission_ticket_tasks
    WHERE submission_id = ${submissionId}
    ORDER BY sort_order ASC, id ASC
  `)
  return rows.map(r => ({
    kind: r.kind,
    external_id: Number(r.external_id),
    sort_order: r.sort_order,
  }))
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
      d.resolved_by, d.created_at, d.resolved_at, d.reopen_count,
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
    logger.error('Error getting score breakdown:', error)
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

import logger from '../../config/logger';