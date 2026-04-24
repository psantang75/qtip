/**
 * Completed-submissions list for the trainer "completed" view.
 *
 * Powers `GET /api/trainer/completed`. Almost identical to the QA
 * completed-list endpoint, but the trainer surface defaults to
 * `limit = 1000` (caps at 1000) — historically used to feed an unpaged
 * lookup table — and exposes the auditor name plus a "No CSR assigned"
 * fallback. Kept distinct from the QA list service so the limit defaults
 * and column shape don't drift.
 *
 * Extracted from the old `controllers/trainer.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TrainerCompletedSubmissionsParams {
  page:       number
  limit:      number
  formId?:    number | null
  dateStart?: string
  dateEnd?:   string
  status?:    string
  search?:    string
}

export interface TrainerCompletedSubmissionsResult {
  data: any[]
  pagination: {
    page:       number
    limit:      number
    total:      number
    totalPages: number
  }
}

export async function listTrainerCompletedSubmissions(
  params: TrainerCompletedSubmissionsParams,
): Promise<TrainerCompletedSubmissionsResult> {
  const { page, limit, formId, dateStart, dateEnd, status, search } = params
  const offset = (page - 1) * limit

  const sqlConditions: Prisma.Sql[] = [
    Prisma.sql`(s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')`,
  ]
  if (formId)    sqlConditions.push(Prisma.sql`s.form_id      = ${formId}`)
  if (dateStart) sqlConditions.push(Prisma.sql`s.submitted_at >= ${dateStart + ' 00:00:00'}`)
  if (dateEnd)   sqlConditions.push(Prisma.sql`s.submitted_at <= ${dateEnd   + ' 23:59:59'}`)
  if (status && (status === 'FINALIZED' || status === 'DISPUTED' || status === 'SUBMITTED')) {
    sqlConditions.push(Prisma.sql`s.status = ${status}`)
  }
  if (search) {
    const term = `%${search}%`
    sqlConditions.push(
      Prisma.sql`(f.form_name LIKE ${term} OR csr.username LIKE ${term} OR auditor.username LIKE ${term})`,
    )
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`

  const countResult = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT s.id) AS total
    FROM submissions s
    JOIN forms  f       ON s.form_id      = f.id
    JOIN users  auditor ON s.submitted_by = auditor.id
    LEFT JOIN (
      SELECT DISTINCT sm.submission_id, sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE fmf.field_name = 'CSR'
    ) csr_meta ON s.id = csr_meta.submission_id
    LEFT JOIN users csr ON CAST(csr_meta.value AS UNSIGNED) = csr.id
    ${whereClause}
  `)

  const total = Number(countResult[0]?.total ?? 0)

  const submissions = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id,
      s.form_id,
      f.form_name,
      auditor.username                          AS auditor_name,
      COALESCE(csr.username, 'No CSR assigned') AS csr_name,
      s.submitted_at,
      s.total_score,
      s.status
    FROM submissions s
    JOIN forms  f       ON s.form_id      = f.id
    JOIN users  auditor ON s.submitted_by = auditor.id
    LEFT JOIN (
      SELECT DISTINCT sm.submission_id, sm.value
      FROM submission_metadata sm
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE fmf.field_name = 'CSR'
    ) csr_meta ON s.id = csr_meta.submission_id
    LEFT JOIN users csr ON CAST(csr_meta.value AS UNSIGNED) = csr.id
    ${whereClause}
    ORDER BY s.submitted_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return {
    data: submissions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
}
