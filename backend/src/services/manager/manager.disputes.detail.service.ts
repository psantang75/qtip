/**
 * Single dispute detail (with score history, answers, and call data).
 *
 * GET /api/manager/disputes/:disputeId
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { getDisputeScoreHistory } from '../../utils/disputeScoreHistory'
import { getCsrRoleId, getManagedDepartmentIds } from './manager.access'
import { ManagerServiceError } from './manager.types'

export interface DisputeDetailParams {
  userId: number
  userRole: string | undefined
  disputeId: string
}

export interface DisputeDetail {
  dispute_id: number
  submission_id: number
  csr_name: string
  form_name: string
  total_score: number | null
  previous_score: number | null
  adjusted_score: number | null
  submitted_at: Date | string
  reason: string | null
  status: string
  created_at: Date | string
  resolved_at: Date | string | null
  resolution_notes: string | null
  score_history: Awaited<ReturnType<typeof getDisputeScoreHistory>>
  answers: Array<{
    question_id: number
    question_text: string
    answer: string | null
    notes: string | null
  }>
  call: { transcript: string | null; audio_url: string | null } | null
}

export async function getManagerDisputeDetails(
  params: DisputeDetailParams,
): Promise<DisputeDetail> {
  const csrRoleId = await getCsrRoleId()

  let whereClause = 'WHERE d.id = ?'
  const queryParams: unknown[] = [params.disputeId]

  if (params.userRole === 'Manager') {
    const departmentIds = await getManagedDepartmentIds(params.userId)
    if (departmentIds.length === 0) {
      throw new ManagerServiceError(
        'No departments found for this manager',
        403,
        'NO_DEPARTMENTS',
      )
    }
    whereClause += ` AND u.department_id IN (${departmentIds.map(() => '?').join(',')})`
    queryParams.push(...departmentIds)
  }

  whereClause += ' AND u.role_id = ?'
  queryParams.push(csrRoleId)

  const disputeRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       d.*,
       s.total_score,
       s.submitted_at,
       f.form_name,
       u.username as csr_name,
       qa.username as qa_analyst_name
     FROM disputes d
     JOIN submissions s ON d.submission_id = s.id
     JOIN submission_metadata sm ON s.id = sm.submission_id
     JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
     JOIN users u ON sm.value = u.id
     JOIN forms f ON s.form_id = f.id
     JOIN users qa ON s.submitted_by = qa.id
     ${whereClause}`,
    ...queryParams,
  )

  if (disputeRows.length === 0) {
    throw new ManagerServiceError(
      'Dispute not found or not accessible',
      404,
      'NOT_FOUND',
    )
  }

  const dispute = disputeRows[0]
  const scoreHistory = await getDisputeScoreHistory(null, Number(dispute.id))
  const previousScore =
    scoreHistory.find((entry) => entry.score_type === 'PREVIOUS')?.score ?? null
  const adjustedScore =
    [...scoreHistory].reverse().find((entry) => entry.score_type === 'ADJUSTED')?.score ?? null

  const submissionId = Number(dispute.submission_id)

  const answers = await prisma.$queryRaw<Array<{
    question_id: number
    answer: string | null
    notes: string | null
    question_text: string
  }>>(Prisma.sql`
    SELECT sa.question_id, sa.answer, sa.notes, fq.question_text
    FROM submission_answers sa
    JOIN form_questions fq ON sa.question_id = fq.id
    WHERE sa.submission_id = ${submissionId}
    ORDER BY fq.id
  `)

  const callRows = await prisma.$queryRaw<Array<{ transcript: string | null; audio_url: string | null }>>(
    Prisma.sql`
      SELECT c.transcript, c.recording_url as audio_url
      FROM calls c
      WHERE c.id = (SELECT call_id FROM submissions WHERE id = ${submissionId})
    `,
  )

  return {
    dispute_id: Number(dispute.id),
    submission_id: submissionId,
    csr_name: String(dispute.csr_name),
    form_name: String(dispute.form_name),
    total_score: dispute.total_score == null ? null : Number(dispute.total_score),
    previous_score: previousScore == null ? null : Number(previousScore),
    adjusted_score: adjustedScore == null ? null : Number(adjustedScore),
    submitted_at: dispute.submitted_at as Date | string,
    reason: (dispute.reason as string) ?? null,
    status: String(dispute.status),
    created_at: dispute.created_at as Date | string,
    resolved_at: (dispute.resolved_at as Date | string | null) ?? null,
    resolution_notes: (dispute.resolution_notes as string) ?? null,
    score_history: scoreHistory,
    answers: answers.map((a) => ({
      question_id: a.question_id,
      question_text: a.question_text,
      answer: a.answer,
      notes: a.notes,
    })),
    call: callRows.length > 0
      ? { transcript: callRows[0].transcript, audio_url: callRows[0].audio_url }
      : null,
  }
}
