/**
 * Writeup search paths: surface QA records and prior coaching sessions for
 * the "find prior incidents" pickers inside the writeup form.
 *
 * Both queries return at most 100 / 50 rows (LIMIT-driven). Extracted from
 * the old `controllers/writeup.controller.ts` during the pre-production
 * review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { WriteUpServiceError } from './writeup.types'

export interface SearchQaRecordsParams {
  csrId: number
  formId?: number
  dateFrom?: string
  dateTo?: string
  questionText?: string
  failedOnly: boolean
  questionIds: string[]
  answerValues: string[]
}

export interface SearchCoachingSessionsParams {
  csrId: number
  dateFrom?: string
  dateTo?: string
  topicNames: string[]
}

/**
 * Search QA submission answers for a CSR. Supports OR-based multi-question
 * search (one branch per (questionId, answerValue) pair). When no specific
 * question is selected and `failedOnly` is true, the query restricts to
 * common failing answer tokens (`No`, `FAIL`, `0`, `false`, etc).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function searchQaRecords(params: SearchQaRecordsParams): Promise<any[]> {
  if (!params.csrId) {
    throw new WriteUpServiceError('csr_id is required', 400, 'WRITEUP_VALIDATION')
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`(CAST(csr_meta.value AS UNSIGNED) = ${params.csrId} OR c.csr_id = ${params.csrId})`,
  ]

  if (params.formId)      conditions.push(Prisma.sql`s.form_id = ${params.formId}`)
  if (params.dateFrom)    conditions.push(Prisma.sql`COALESCE(idate_meta.date_value, DATE(s.submitted_at)) >= ${params.dateFrom}`)
  if (params.dateTo)      conditions.push(Prisma.sql`COALESCE(idate_meta.date_value, DATE(s.submitted_at)) <= ${params.dateTo}`)
  if (params.questionText) {
    conditions.push(Prisma.sql`fq.question_text LIKE ${'%' + params.questionText + '%'}`)
  }

  if (params.questionIds.length > 0) {
    const orConds = params.questionIds.map((qid, i) => {
      const ans = params.answerValues[i]
      if (ans) return Prisma.sql`(sa.question_id = ${parseInt(qid)} AND LOWER(sa.answer) = LOWER(${ans}))`
      return Prisma.sql`sa.question_id = ${parseInt(qid)}`
    })
    conditions.push(
      orConds.length === 1
        ? orConds[0]
        : Prisma.sql`(${Prisma.join(orConds, ' OR ')})`,
    )
  } else if (params.failedOnly) {
    conditions.push(Prisma.sql`sa.answer IN ('No', 'FAIL', 'no', 'fail', '0', 'false')`)
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT DISTINCT
      s.id as submission_id,
      s.submitted_at as submission_date,
      COALESCE(idate_meta.date_value, DATE(s.submitted_at)) as interaction_date,
      f.form_name, sa.question_id as matched_question_id, fc.category_name, fq.question_text, sa.answer, sa.notes
    FROM submissions s
    JOIN forms f ON s.form_id = f.id
    JOIN submission_answers sa ON sa.submission_id = s.id
    JOIN form_questions fq ON fq.id = sa.question_id
    LEFT JOIN form_categories fc ON fq.category_id = fc.id
    LEFT JOIN (
      SELECT DISTINCT sm.submission_id, sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE fmf.field_name = 'CSR'
    ) csr_meta ON s.id = csr_meta.submission_id
    LEFT JOIN (
      SELECT sm.submission_id, MIN(sm.date_value) as date_value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE fmf.field_name IN ('Interaction Date', 'Call Date')
      GROUP BY sm.submission_id
    ) idate_meta ON s.id = idate_meta.submission_id
    LEFT JOIN calls c ON s.call_id = c.id
    ${whereClause}
    ORDER BY COALESCE(idate_meta.date_value, DATE(s.submitted_at)) DESC
    LIMIT 100
  `)
}

/**
 * Search coaching sessions for a CSR. Topic filters are OR-joined so the
 * picker can match on any of the selected topic names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function searchCoachingSessions(params: SearchCoachingSessionsParams): Promise<any[]> {
  if (!params.csrId) {
    throw new WriteUpServiceError('csr_id is required', 400, 'WRITEUP_VALIDATION')
  }

  const conditions: Prisma.Sql[] = [Prisma.sql`cs.csr_id = ${params.csrId}`]

  if (params.dateFrom) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${params.dateFrom}`)
  if (params.dateTo)   conditions.push(Prisma.sql`DATE(cs.session_date) <= ${params.dateTo}`)
  if (params.topicNames.length > 0) {
    const orConds = params.topicNames.map(n => Prisma.sql`li_t.label LIKE ${'%' + n + '%'}`)
    conditions.push(
      orConds.length === 1
        ? orConds[0]
        : Prisma.sql`(${Prisma.join(orConds, ' OR ')})`,
    )
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT cs.id as session_id, cs.session_date, cs.coaching_purpose, cs.status, cs.notes,
      GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ', ') as topic_names
    FROM coaching_sessions cs
    LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
    LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
    ${whereClause}
    GROUP BY cs.id
    ORDER BY cs.session_date DESC
    LIMIT 50
  `)

  return rows.map(r => ({ ...r, topic_names: r.topic_names ? r.topic_names.split(', ') : [] }))
}
