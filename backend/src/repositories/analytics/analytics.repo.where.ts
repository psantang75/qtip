/**
 * Shared SQL WHERE-clause builders for analytics queries.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29. The same per-filter
 * conditions (departments, forms, csrs, categories, questions) were
 * inlined into 3-4 different SQL methods with subtle differences
 * (e.g. allowing NULL CSRs only in the detailed-export path). One
 * canonical builder per filter now lives here, with options to flip
 * the strict / lenient behaviours.
 */

import { Prisma } from '../../generated/prisma/client'

interface DepartmentScopeOptions {
  /** Fully qualified SQL column for the user's department, e.g. `u.department_id`. */
  column: 'u.department_id' | 'csr_user.department_id'
  /** When true, rows with NULL department_id pass the filter (used by export queries). */
  allowNull?: boolean
}

/**
 * Resolve `department_id` / `departmentIds` / Manager-scope filtering
 * down to a single AND-prefixed SQL fragment. Returns an empty
 * fragment when no department scoping should apply.
 */
export function buildDepartmentScopeCondition(
  filters: any,
  user_id: number,
  userRole: string | undefined,
  options: DepartmentScopeOptions,
): Prisma.Sql {
  const col = Prisma.raw(options.column)
  const allowNull = options.allowNull ?? false

  if ('departmentIds' in filters && filters.departmentIds?.length > 0) {
    const ids = Prisma.join(filters.departmentIds)
    return allowNull
      ? Prisma.sql`AND (${col} IN (${ids}) OR ${col} IS NULL)`
      : Prisma.sql`AND ${col} IN (${ids})`
  }

  if ('department_id' in filters && filters.department_id) {
    return allowNull
      ? Prisma.sql`AND (${col} = ${filters.department_id} OR ${col} IS NULL)`
      : Prisma.sql`AND ${col} = ${filters.department_id}`
  }

  if (userRole === 'Manager') {
    return allowNull
      ? Prisma.sql`AND (${col} IN (
          SELECT DISTINCT dm.department_id
          FROM department_managers dm
          WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
        ) OR ${col} IS NULL)`
      : Prisma.sql`AND ${col} IN (
          SELECT DISTINCT dm.department_id
          FROM department_managers dm
          WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
        )`
  }

  return Prisma.sql``
}

/**
 * Resolve `form_id` / `formIds` filtering. Always strict.
 */
export function buildFormScopeCondition(filters: any): Prisma.Sql {
  if ('formIds' in filters && filters.formIds?.length > 0) {
    return filters.formIds.length === 1
      ? Prisma.sql`AND s.form_id = ${filters.formIds[0]}`
      : Prisma.sql`AND s.form_id IN (${Prisma.join(filters.formIds)})`
  }
  if ('form_id' in filters && filters.form_id) {
    return Prisma.sql`AND s.form_id = ${filters.form_id}`
  }
  return Prisma.sql``
}

interface CsrScopeOptions {
  /** When true, rows with NULL `sm.value` pass the filter. */
  allowNull?: boolean
}

/**
 * Resolve `csrIds` filtering against the CSR submission_metadata
 * column. Returns empty when no CSR scoping should apply.
 */
export function buildCsrScopeCondition(
  filters: any,
  options: CsrScopeOptions = {},
): Prisma.Sql {
  if (!('csrIds' in filters) || !filters.csrIds?.length) return Prisma.sql``
  const ids = Prisma.join(filters.csrIds)
  return options.allowNull
    ? Prisma.sql`AND (CAST(sm.value AS UNSIGNED) IN (${ids}) OR sm.value IS NULL)`
    : Prisma.sql`AND CAST(sm.value AS UNSIGNED) IN (${ids})`
}

/**
 * Category scoping for queries that don't have a direct `fc` join
 * available — generates the EXISTS-subquery form. Use the direct
 * `fc.id IN (...)` form inline when the query already joins
 * `form_categories fc`.
 */
export function buildCategoryExistsCondition(filters: any): Prisma.Sql {
  if ('categoryIds' in filters && filters.categoryIds?.length > 0) {
    return Prisma.sql`AND EXISTS (
      SELECT 1 FROM submission_answers sa
      INNER JOIN form_questions fq ON sa.question_id = fq.id
      WHERE sa.submission_id = s.id
        AND fq.category_id IN (${Prisma.join(filters.categoryIds)})
    )`
  }
  if ('category_id' in filters && filters.category_id) {
    return Prisma.sql`AND EXISTS (
      SELECT 1 FROM submission_answers sa
      INNER JOIN form_questions fq ON sa.question_id = fq.id
      WHERE sa.submission_id = s.id
        AND fq.category_id = ${filters.category_id}
    )`
  }
  return Prisma.sql``
}

/**
 * Question scoping for queries that don't have a direct `fq` join
 * available — generates the EXISTS-subquery form.
 */
export function buildQuestionExistsCondition(filters: any): Prisma.Sql {
  if ('questionIds' in filters && filters.questionIds?.length > 0) {
    return Prisma.sql`AND EXISTS (
      SELECT 1 FROM submission_answers sa
      WHERE sa.submission_id = s.id
        AND sa.question_id IN (${Prisma.join(filters.questionIds)})
    )`
  }
  if ('question_id' in filters && filters.question_id) {
    return Prisma.sql`AND EXISTS (
      SELECT 1 FROM submission_answers sa
      WHERE sa.submission_id = s.id
        AND sa.question_id = ${filters.question_id}
    )`
  }
  return Prisma.sql``
}

/**
 * Join an array of conditions into a single `Prisma.Sql` fragment,
 * collapsing the empty list to a no-op.
 */
export function joinConditions(conditions: Prisma.Sql[]): Prisma.Sql {
  return conditions.length > 0
    ? Prisma.join(conditions, ' ')
    : Prisma.sql``
}
