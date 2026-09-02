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
import { accessScopeSql } from '../../utils/formScope'
import type { CompletedSubmissionsParams, CompletedSubmissionsResult } from './qa.types'

// DRAFT included so AI Reviewer drafts (Calibrating mode) and any
// human work-in-progress show up alongside Submitted/Disputed/Finalized
// rows on the Completed Forms list. The frontend status filter still
// drives what the user sees by default.
const ALLOWED_STATUSES = new Set(['FINALIZED', 'DISPUTED', 'SUBMITTED', 'DRAFT'])

export async function listCompletedSubmissions(params: CompletedSubmissionsParams): Promise<CompletedSubmissionsResult> {
  const { page, limit, formId, dateStart, dateEnd, status, search, submittedBy } = params
  const accessScope = params.accessScope ?? 'STANDARD'
  const permittedInternalFormIds = params.permittedInternalFormIds ?? []
  const offset = (page - 1) * limit

  // INTERNAL scope with no permitted forms can never match a row — short-circuit
  // rather than emit an invalid `IN ()`. Keeps the audience gate fail-closed.
  if (accessScope === 'INTERNAL' && permittedInternalFormIds.length === 0) {
    return { data: [], pagination: { total: 0, page, limit, totalPages: 0 } }
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`s.status IN ('FINALIZED', 'DISPUTED', 'SUBMITTED', 'DRAFT')`,
    // STANDARD lists normal audits (access_mode IS NULL); INTERNAL lists
    // Internal-form audits (access_mode = 'INTERNAL'). Internal audits are
    // otherwise excluded from the normal Quality workflow "as if they never
    // existed" and only surface for their permitted audience.
    accessScopeSql(accessScope, 's'),
  ]

  // Internal scope is additionally fenced to the forms the requester is
  // permitted to see (admin = all; others = audience match).
  if (accessScope === 'INTERNAL') {
    conditions.push(Prisma.sql`s.form_id IN (${Prisma.join(permittedInternalFormIds)})`)
  }

  // Author self-scope: QA viewers see only audits they submitted.
  if (submittedBy) conditions.push(Prisma.sql`s.submitted_by = ${submittedBy}`)
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

  // `unlock_open` is CAST to CHAR because MySQL types EXISTS() as BIGINT and
  // mysql2 hands that back as a JS BigInt, which res.json() cannot serialize.
  // Same guard as loadTicketTasks in qa.submissions.detail.service.
  const rawRows = await prisma.$queryRaw<{
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
    ai_overall_confidence: number | null
    reopen_count: number
    unlock_open: string
    access_mode: string | null
  }[]>(
    Prisma.sql`
      SELECT
        s.id,
        s.form_id,
        s.access_mode,
        f.form_name,
        auditor.username AS auditor_name,
        COALESCE(csr.username, 'No CSR assigned') AS csr_name,
        s.submitted_at,
        s.total_score,
        s.status,
        s.critical_fail_count,
        s.score_capped,
        s.ai_overall_confidence,
        s.reopen_count,
        CAST(EXISTS (
          SELECT 1 FROM record_unlock ru
          WHERE ru.entity_type = 'SUBMISSION' AND ru.entity_id = s.id AND ru.state = 'OPEN'
        ) AS CHAR) AS unlock_open,
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

  const rows = rawRows.map(r => ({ ...r, unlock_open: Number(r.unlock_open) }))

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
