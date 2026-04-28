/**
 * Detailed view of a single team audit (submission).
 *
 * GET /api/manager/team-audits/:id
 *
 * Returns the submission, its metadata + answers, optional dispute, the form
 * structure (categories + questions), and a score breakdown so the client
 * can render the same UI used for the QA detail page.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { serviceLogger } from '../../config/logger'
import { ManagerServiceError } from './manager.types'

export interface AuditDetailParams {
  userId: number
  userRole: string | undefined
  submissionId: number
}

export interface AuditDetailResponse {
  id: number
  form_id: number
  submitted_by: number
  submitted_at: Date | string
  total_score: number
  status: string
  form: {
    id: number
    form_name: string
    version: number
    interaction_type: string
    categories?: unknown
  }
  qaAnalystName: string | null
  csrName: string | null
  isDisputable: boolean
  metadata: Array<Record<string, unknown>>
  calls: Array<Record<string, unknown>>
  /** Reference-only — frontend live-fetches header + notes from /api/crm. */
  ticket_tasks: Array<{ kind: 'TICKET' | 'TASK'; external_id: number; sort_order: number }>
  answers: Array<Record<string, unknown>>
  dispute: Record<string, unknown> | null
  scoreBreakdown?: unknown
}

const CSR_FIELD_NAME = 'CSR'

async function assertAccess(
  userId: number,
  userRole: string | undefined,
  submissionId: number,
): Promise<void> {
  if (userRole === 'Manager') {
    const verifyRows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT s.id
      FROM submissions s
      JOIN submission_metadata sm ON sm.submission_id = s.id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users csr_user ON CAST(sm.value AS UNSIGNED) = csr_user.id
      JOIN departments dept ON csr_user.department_id = dept.id
      JOIN department_managers dm ON dept.id = dm.department_id
      WHERE s.id = ${submissionId}
        AND fmf.field_name = ${CSR_FIELD_NAME}
        AND dm.manager_id = ${userId}
        AND dm.is_active = 1
        AND dept.is_active = 1
        AND csr_user.is_active = 1
    `)
    if (verifyRows.length === 0) {
      throw new ManagerServiceError(
        'Audit not found or you do not have permission to view it',
        404,
        'NOT_FOUND',
        'plain',
      )
    }
  } else {
    const verifyRows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT s.id FROM submissions s WHERE s.id = ${submissionId}
    `)
    if (verifyRows.length === 0) {
      throw new ManagerServiceError('Audit not found', 404, 'NOT_FOUND', 'plain')
    }
  }
}

interface SubmissionRow {
  id: number
  form_id: number
  submitted_by: number
  submitted_at: Date | string
  total_score: number | string | null
  status: string
  form_name: string
  version: number
  interaction_type: string
}

async function loadFormStructure(formId: number) {
  const categoriesRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT fc.id, fc.category_name, fc.weight, fc.sort_order
    FROM form_categories fc
    WHERE fc.form_id = ${formId}
    ORDER BY fc.sort_order ASC
  `)
  if (categoriesRows.length === 0) return null

  const questionsRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT fq.id, fq.category_id, fq.question_text, fq.question_type, fq.weight,
           fq.is_na_allowed, fq.scale_min, fq.scale_max, fq.yes_value, fq.no_value,
           fq.sort_order
    FROM form_questions fq
    JOIN form_categories fc ON fq.category_id = fc.id
    WHERE fc.form_id = ${formId}
    ORDER BY fc.sort_order ASC, fq.sort_order ASC
  `)

  return categoriesRows.map((category) => ({
    ...category,
    questions: questionsRows.filter((q) => q.category_id === category.id),
  }))
}

export async function getManagerTeamAuditDetails(
  params: AuditDetailParams,
): Promise<AuditDetailResponse> {
  if (!Number.isFinite(params.submissionId) || params.submissionId <= 0) {
    throw new ManagerServiceError('Invalid audit ID', 400, 'INVALID_AUDIT_ID')
  }

  await assertAccess(params.userId, params.userRole, params.submissionId)

  const submissionRows = await prisma.$queryRaw<SubmissionRow[]>(Prisma.sql`
    SELECT s.id, s.form_id, s.submitted_by, s.submitted_at, s.total_score, s.status,
           f.form_name, f.version, f.interaction_type
    FROM submissions s
    JOIN forms f ON s.form_id = f.id
    WHERE s.id = ${params.submissionId}
  `)
  if (submissionRows.length === 0) {
    throw new ManagerServiceError('Submission not found', 404, 'NOT_FOUND', 'plain')
  }
  const submission = submissionRows[0]

  const [metadata, calls, ticketTaskRows, answers, qaResults] = await Promise.all([
    prisma.$queryRaw<Array<{ field_name: string; value: string }>>(Prisma.sql`
      SELECT fmf.field_name, sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE sm.submission_id = ${params.submissionId}
    `),
    prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT c.call_id, c.customer_id, c.call_date, c.duration, c.recording_url, c.transcript
      FROM submission_calls sc
      JOIN calls c ON sc.call_id = c.id
      WHERE sc.submission_id = ${params.submissionId}
      ORDER BY sc.sort_order ASC
    `),
    prisma.$queryRaw<Array<{ kind: 'TICKET' | 'TASK'; external_id: string; sort_order: number }>>(Prisma.sql`
      SELECT kind, CAST(external_id AS CHAR) AS external_id, sort_order
      FROM submission_ticket_tasks
      WHERE submission_id = ${params.submissionId}
      ORDER BY sort_order ASC, id ASC
    `),
    prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT sa.question_id, fq.question_text, sa.answer, sa.notes, fq.question_type,
        CASE
          WHEN fq.question_type = 'YES_NO' AND sa.answer = 'YES' THEN fq.yes_value
          WHEN fq.question_type = 'YES_NO' AND sa.answer = 'NO' THEN fq.no_value
          WHEN fq.question_type = 'SCALE' THEN sa.answer
          ELSE NULL
        END as score
      FROM submission_answers sa
      JOIN form_questions fq ON sa.question_id = fq.id
      WHERE sa.submission_id = ${params.submissionId}
    `),
    prisma.$queryRaw<Array<{ username: string }>>(Prisma.sql`
      SELECT username FROM users WHERE id = ${submission.submitted_by}
    `),
  ])

  const qaAnalystName = qaResults.length > 0 ? qaResults[0].username : null

  const csrMeta = metadata.find((m) => m.field_name === CSR_FIELD_NAME)
  let csrName: string | null = null
  if (csrMeta?.value) {
    const csrResults = await prisma.$queryRaw<Array<{ username: string }>>(Prisma.sql`
      SELECT username FROM users WHERE id = ${csrMeta.value}
    `)
    csrName = csrResults.length > 0 ? csrResults[0].username : null
  }

  const disputeRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      d.id, d.reason, d.status, d.resolution_notes, d.attachment_url,
      d.created_at, d.resolved_at,
      disputed_user.username as disputed_by_name,
      resolved_user.username as resolved_by_name,
      (
        SELECT dsh.score FROM dispute_score_history dsh
        WHERE dsh.dispute_id = d.id AND dsh.score_type = 'PREVIOUS'
        ORDER BY dsh.created_at ASC, dsh.id ASC LIMIT 1
      ) as previous_score,
      (
        SELECT dsh.score FROM dispute_score_history dsh
        WHERE dsh.dispute_id = d.id AND dsh.score_type = 'ADJUSTED'
        ORDER BY dsh.created_at DESC, dsh.id DESC LIMIT 1
      ) as new_score
    FROM disputes d
    LEFT JOIN users disputed_user ON d.disputed_by = disputed_user.id
    LEFT JOIN users resolved_user ON d.resolved_by = resolved_user.id
    WHERE d.submission_id = ${params.submissionId}
  `)

  const response: AuditDetailResponse = {
    id: submission.id,
    form_id: submission.form_id,
    submitted_by: submission.submitted_by,
    submitted_at: submission.submitted_at,
    total_score: parseFloat(String(submission.total_score ?? 0)),
    status: submission.status,
    form: {
      id: submission.form_id,
      form_name: submission.form_name,
      version: submission.version,
      interaction_type: submission.interaction_type,
    },
    qaAnalystName,
    csrName,
    isDisputable: false,
    metadata,
    calls,
    ticket_tasks: ticketTaskRows.map((r) => ({
      kind: r.kind,
      external_id: Number(r.external_id),
      sort_order: r.sort_order,
    })),
    answers,
    dispute: disputeRows.length > 0 ? disputeRows[0] : null,
  }

  // Form structure + score breakdown are best-effort: log and continue if
  // they fail rather than failing the whole detail response.
  try {
    const categories = await loadFormStructure(submission.form_id)
    if (categories) response.form.categories = categories
  } catch (err) {
    serviceLogger.error('MANAGER', 'Error fetching form structure:', err as Error)
  }

  try {
    const { getScoreBreakdown } = await import('../../utils/scoringUtil')
    response.scoreBreakdown = await getScoreBreakdown(null, params.submissionId)
  } catch (err) {
    serviceLogger.error('MANAGER', 'Error getting score breakdown:', err as Error)
  }

  return response
}
