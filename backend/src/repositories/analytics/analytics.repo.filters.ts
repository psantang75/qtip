/**
 * `getFilterOptions` repository module.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29. Loads all five filter
 * options (departments / forms / csrs / categories / questions) in
 * parallel, scoping departments and CSRs by Manager visibility when
 * needed.
 *
 * The legacy `datePresets` array was removed during pre-production
 * cleanup item #25 — see `services/analytics/analytics.types.ts` and
 * `interfaces/IAnalyticsRepository.ts` for the rationale. Use
 * `utils/periodUtils.ts` (`resolvePeriod`) for the canonical period
 * vocabulary.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { resolveAnalyticsUserRole } from './analytics.repo.userRole'

export interface AnalyticsFilterOptionsResult {
  departments: any[]
  forms: any[]
  csrs: any[]
  categories?: any[]
  questions?: any[]
}

export async function getAnalyticsFilterOptionsRepo(
  user_id: number,
  userRole?: string,
): Promise<AnalyticsFilterOptionsResult> {
  try {
    const role = await resolveAnalyticsUserRole(user_id, userRole)
    const isManager = role === 'Manager'

    const departmentsPromise = isManager
      ? prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT DISTINCT d.id, d.department_name
          FROM departments d
          INNER JOIN department_managers dm ON d.id = dm.department_id
          WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
          ORDER BY d.department_name
        `)
      : prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT id, department_name
          FROM departments
          ORDER BY department_name
        `)

    const formsPromise = prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT id, form_name, user_version, user_version_date, is_active, version
      FROM forms
      ORDER BY form_name, version DESC
    `)

    const csrsPromise = isManager
      ? prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT u.id, u.username, u.department_id
          FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'CSR' AND u.is_active = 1
            AND u.department_id IN (
              SELECT DISTINCT dm.department_id
              FROM department_managers dm
              WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
            )
          ORDER BY u.username
        `)
      : prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT u.id, u.username, u.department_id
          FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'CSR' AND u.is_active = 1
          ORDER BY u.username
        `)

    const categoriesPromise = prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT
        fc.id,
        fc.category_name as name,
        fc.form_id,
        COALESCE(SUM(
          CASE
            WHEN fq.question_type = 'yes_no' AND fq.yes_value > 0 THEN fq.yes_value
            WHEN fq.question_type = 'scale' AND fq.scale_max > 0 THEN fq.scale_max
            WHEN fq.question_type = 'radio' THEN COALESCE((
              SELECT MAX(ro.score)
              FROM radio_options ro
              WHERE ro.question_id = fq.id AND ro.score > 0
            ), 0)
            ELSE 0
          END
        ), 0) AS possible_points
      FROM form_categories fc
      INNER JOIN forms f ON fc.form_id = f.id
      LEFT JOIN form_questions fq ON fc.id = fq.category_id
      WHERE fc.weight > 0
        AND fq.question_type != 'SUB_CATEGORY'
        AND fq.question_type != 'TEXT'
        AND NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)
        AND NOT (
          fq.question_type = 'RADIO'
          AND NOT EXISTS (
            SELECT 1 FROM radio_options ro
            WHERE ro.question_id = fq.id AND ro.score > 0
          )
        )
      GROUP BY fc.id, fc.category_name, fc.form_id
      HAVING possible_points > 0
      ORDER BY fc.category_name
    `)

    const questionsPromise = prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT fq.id, fq.question_text as name, fc.form_id, f.form_name,
             fq.category_id, fc.category_name, fq.question_type, fq.yes_value
      FROM form_questions fq
      INNER JOIN form_categories fc ON fq.category_id = fc.id
      INNER JOIN forms f ON fc.form_id = f.id
      INNER JOIN (
        SELECT fc.id as category_id
        FROM form_categories fc
        LEFT JOIN form_questions fq ON fc.id = fq.category_id
        WHERE fc.weight > 0
          AND fq.question_type != 'SUB_CATEGORY'
          AND fq.question_type != 'TEXT'
          AND NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)
          AND NOT (
            fq.question_type = 'RADIO'
            AND NOT EXISTS (
              SELECT 1 FROM radio_options ro
              WHERE ro.question_id = fq.id AND ro.score > 0
            )
          )
        GROUP BY fc.id
        HAVING COALESCE(SUM(
          CASE
            WHEN fq.question_type = 'yes_no' AND fq.yes_value > 0 THEN fq.yes_value
            WHEN fq.question_type = 'scale' AND fq.scale_max > 0 THEN fq.scale_max
            WHEN fq.question_type = 'radio' THEN COALESCE((
              SELECT MAX(ro.score)
              FROM radio_options ro
              WHERE ro.question_id = fq.id AND ro.score > 0
            ), 0)
            ELSE 0
          END
        ), 0) > 0
      ) valid_categories ON fc.id = valid_categories.category_id
      WHERE fc.weight > 0
        AND NOT (
          fq.question_type = 'RADIO'
          AND NOT EXISTS (
            SELECT 1 FROM radio_options ro
            WHERE ro.question_id = fq.id AND ro.score > 0
          )
        )
      ORDER BY f.form_name, fc.category_name, fq.question_text
    `)

    const [departments, forms, csrs, categories, questions] = await Promise.all([
      departmentsPromise,
      formsPromise,
      csrsPromise,
      categoriesPromise,
      questionsPromise,
    ])

    return { departments, forms, csrs, categories, questions }
  } catch (error) {
    console.error('Error fetching filter options:', error)
    throw new Error('Failed to fetch filter options')
  }
}
