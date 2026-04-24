/**
 * QA score data repository.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29. Hosts the two read paths
 * that power QA score visualisations:
 *
 *  - `getQAScoreData` — strict join (CSR/department required), used
 *    by trends + distribution + summary endpoints.
 *  - `getDetailedQAScoreData` — lenient join (NULL CSR allowed),
 *    used by the QA-scores Excel export so audits with missing
 *    CSR metadata still appear.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type {
  ReportFilters,
  ComprehensiveReportFilters,
} from '../../types/analytics.types'
import { resolveAnalyticsUserRole } from './analytics.repo.userRole'
import {
  buildCategoryExistsCondition,
  buildCsrScopeCondition,
  buildDepartmentScopeCondition,
  buildFormScopeCondition,
  buildQuestionExistsCondition,
  joinConditions,
} from './analytics.repo.where'

type AnalyticsFilters = ReportFilters | ComprehensiveReportFilters

export async function getQAScoreDataRepo(
  filters: AnalyticsFilters,
  user_id: number,
  userRole?: string,
): Promise<any[]> {
  try {
    const role = await resolveAnalyticsUserRole(user_id, userRole)

    const useCategoryScore = 'category_id' in filters && filters.category_id
    const useQuestionScore = 'question_id' in filters && filters.question_id

    const endDateWithTime = `${filters.end_date} 23:59:59`
    const scoreFilter = (useCategoryScore || useQuestionScore)
      ? Prisma.sql``
      : Prisma.sql`AND s.total_score IS NOT NULL`

    const extraWhere = joinConditions([
      buildDepartmentScopeCondition(filters, user_id, role, { column: 'u.department_id' }),
      buildFormScopeCondition(filters),
      buildCsrScopeCondition(filters),
      buildCategoryExistsCondition(filters),
      buildQuestionExistsCondition(filters),
    ])

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        DATE(s.submitted_at) AS date,
        s.total_score AS total_score,
        s.id AS submission_id,
        s.submitted_at,
        s.status,
        CAST(sm.value AS UNSIGNED) AS csr_user_id,
        u.username AS csr_username,
        f.form_name,
        d.department_name,
        CAST(sm.value AS UNSIGNED) AS csr_id,
        u.username AS csr_name,
        d.id AS department_id,
        d.department_name AS department_name,
        f.id AS form_id,
        f.form_name AS form_name,
        f.id AS group_id,
        f.form_name AS group_name
      FROM
        submissions s
        INNER JOIN forms f ON s.form_id = f.id
        INNER JOIN submission_metadata sm ON s.id = sm.submission_id
        INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
        INNER JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
        LEFT JOIN departments d ON u.department_id = d.id
      WHERE
        s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED')
        AND s.form_id IN (
          SELECT DISTINCT fc.form_id FROM form_categories fc WHERE fc.weight > 0
        )
        ${scoreFilter}
        ${extraWhere}
      ORDER BY s.submitted_at DESC
    `)

    return rows.map(row => ({
      date: row.date,
      total_score: parseFloat(row.total_score) || 0,
      submission_id: row.submission_id,
      submitted_at: row.submitted_at,
      status: row.status,
      csr_user_id: row.csr_user_id,
      csr_username: row.csr_username,
      form_name: row.form_name,
      department_name: row.department_name,
      group_id: row.group_id,
      group_name: row.group_name,
      csr_name: row.csr_name,
      department_id: row.department_id,
      form_id: row.form_id,
    }))
  } catch (error) {
    console.error('Error fetching QA score data:', error)
    throw new Error('Failed to fetch QA score data')
  }
}

/**
 * Detailed export query. The original implementation falls back to a
 * second pass without the CSR-metadata join when the strict join
 * returns no rows — preserved here for behavioural parity with the
 * legacy export.
 */
export async function getDetailedQAScoreDataRepo(
  filters: AnalyticsFilters,
  user_id: number,
  userRole?: string,
): Promise<any[]> {
  try {
    const role = await resolveAnalyticsUserRole(user_id, userRole)
    const endDateWithTime = `${filters.end_date} 23:59:59`

    const extraConditions: Prisma.Sql[] = [
      buildDepartmentScopeCondition(filters, user_id, role, {
        column: 'u.department_id',
        allowNull: true,
      }),
      buildCsrScopeCondition(filters, { allowNull: true }),
    ]

    if (filters.form_id) {
      extraConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`)
    }
    if ('category_id' in filters && filters.category_id) {
      extraConditions.push(Prisma.sql`AND EXISTS (
        SELECT 1 FROM submission_answers sa
        INNER JOIN form_questions fq ON sa.question_id = fq.id
        WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
      )`)
    }
    if ('question_id' in filters && filters.question_id) {
      extraConditions.push(Prisma.sql`AND EXISTS (
        SELECT 1 FROM submission_answers sa
        WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
      )`)
    }

    const extraWhere = joinConditions(extraConditions)

    let rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        s.id AS submission_id,
        s.total_score AS total_score,
        s.submitted_at,
        s.status,
        f.form_name,
        f.id AS form_id,
        COALESCE(u.username, 'Unknown CSR') AS csr_username,
        COALESCE(CAST(sm.value AS UNSIGNED), 0) AS csr_id,
        COALESCE(d.department_name, 'Unknown Department') AS department_name,
        COALESCE(d.id, 0) AS department_id,
        qa.username AS qa_name,
        qa.id AS qa_id
      FROM
        submissions s
        INNER JOIN forms f ON s.form_id = f.id
        INNER JOIN users qa ON s.submitted_by = qa.id
        LEFT JOIN submission_metadata sm ON s.id = sm.submission_id
        LEFT JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
        LEFT JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
        LEFT JOIN departments d ON u.department_id = d.id
      WHERE
        s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED')
        ${extraWhere}
      ORDER BY s.submitted_at DESC
    `)

    if (rows.length > 0) return rows

    // Fallback: drop the CSR-metadata join entirely to surface
    // submissions without filled metadata so the export isn't empty.
    const fallbackConditions: Prisma.Sql[] = []
    if (filters.form_id) {
      fallbackConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`)
    }
    if ('category_id' in filters && filters.category_id) {
      fallbackConditions.push(Prisma.sql`AND EXISTS (
        SELECT 1 FROM submission_answers sa
        INNER JOIN form_questions fq ON sa.question_id = fq.id
        WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
      )`)
    }
    if ('question_id' in filters && filters.question_id) {
      fallbackConditions.push(Prisma.sql`AND EXISTS (
        SELECT 1 FROM submission_answers sa
        WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
      )`)
    }
    const fallbackExtraWhere = joinConditions(fallbackConditions)

    rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        s.id AS submission_id,
        s.total_score AS total_score,
        s.submitted_at,
        s.status,
        f.form_name,
        f.id AS form_id,
        'Unknown CSR' AS csr_username,
        0 AS csr_id,
        'Unknown Department' AS department_name,
        0 AS department_id,
        qa.username AS qa_name,
        qa.id AS qa_id
      FROM
        submissions s
        INNER JOIN forms f ON s.form_id = f.id
        INNER JOIN users qa ON s.submitted_by = qa.id
      WHERE
        s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED')
        ${fallbackExtraWhere}
      ORDER BY s.submitted_at DESC
    `)

    return rows
  } catch (error) {
    console.error('Error fetching detailed QA score data:', error)
    throw new Error('Failed to fetch detailed QA score data')
  }
}
