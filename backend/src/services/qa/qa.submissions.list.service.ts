/**
 * Completed-submissions list query.
 *
 * Powers `GET /api/qa/completed`. Pagination cap and defaults come from
 * `config/qa.config` so the runtime feature flag stays one source of truth.
 * Extracted from the old `controllers/qa.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type { CompletedSubmissionsParams, CompletedSubmissionsResult } from './qa.types'

const ALLOWED_STATUSES = new Set(['FINALIZED', 'DISPUTED', 'SUBMITTED'])

export async function listCompletedSubmissions(params: CompletedSubmissionsParams): Promise<CompletedSubmissionsResult> {
  const { page, limit, formId, dateStart, dateEnd, status, search } = params
  const offset = (page - 1) * limit

  const conditions: Prisma.Sql[] = [
    Prisma.sql`(s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')`,
  ]

  if (formId)    conditions.push(Prisma.sql`s.form_id = ${formId}`)
  if (dateStart) conditions.push(Prisma.sql`s.submitted_at >= ${dateStart + ' 00:00:00'}`)
  if (dateEnd)   conditions.push(Prisma.sql`s.submitted_at <= ${dateEnd + ' 23:59:59'}`)
  if (status && ALLOWED_STATUSES.has(status)) {
    conditions.push(Prisma.sql`s.status = ${status}`)
  }
  if (search) {
    const like = `%${search}%`
    conditions.push(Prisma.sql`(f.form_name LIKE ${like} OR auditor.username LIKE ${like} OR csr.username LIKE ${like} OR c.customer_id LIKE ${like})`)
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

  // Shared joins between page-of-rows and count queries — kept inline
  // (rather than CTE) because Prisma.sql interpolations don't compose into
  // a CTE without losing parameter binding.
  const baseFrom = Prisma.sql`
    FROM submissions s
    JOIN forms f ON s.form_id = f.id
    JOIN users auditor ON s.submitted_by = auditor.id
    LEFT JOIN (
      SELECT DISTINCT sm.submission_id, sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE fmf.field_name = 'CSR'
    ) csr_meta ON s.id = csr_meta.submission_id
    LEFT JOIN users csr ON CAST(csr_meta.value AS UNSIGNED) = csr.id
    LEFT JOIN calls c ON s.call_id = c.id
  `

  const rows = await prisma.$queryRaw<{
    id: number
    form_id: number
    form_name: string
    auditor_name: string
    csr_name: string
    submitted_at: Date
    total_score: number
    status: string
    interaction_date: string | null
    critical_fail_count: number
    score_capped: number
  }[]>(
    Prisma.sql`
      SELECT
        s.id,
        s.form_id,
        f.form_name,
        auditor.username AS auditor_name,
        COALESCE(csr.username, 'No CSR assigned') AS csr_name,
        s.submitted_at,
        s.total_score,
        s.status,
        s.critical_fail_count,
        s.score_capped,
        (
          SELECT sm.value
          FROM submission_metadata sm
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE sm.submission_id = s.id AND fmf.field_name IN ('Interaction Date', 'Call Date')
          LIMIT 1
        ) AS interaction_date
      ${baseFrom}
      ${whereClause}
      ORDER BY s.submitted_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  )

  const countResult = await prisma.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT COUNT(DISTINCT s.id) AS total ${baseFrom} ${whereClause}`,
  )

  const total = Number(countResult[0]?.total ?? 0)
  const totalPages = Math.ceil(total / limit)

  return {
    data: rows,
    pagination: { total, page, limit, totalPages },
  }
}
