/**
 * `getDetailedSubmissionData` orchestrator.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29. Detects which "shape" of
 * report the caller wants (question / category / form+category /
 * form / default), composes the shared WHERE fragments, dispatches
 * to the appropriate branch query in
 * `analytics.repo.submissions.queries.ts`, then post-processes the
 * raw rows back into the response shape the legacy method returned.
 *
 * Question-level rows additionally enrich each row with
 * (a) recomputed `question_answer_value` based on the radio-options
 * map and (b) a per-row `category_score` from the shared
 * `calculateCategoryScore` helper.
 */

import { Prisma } from '../../generated/prisma/client'
import { resolveAnalyticsUserRole } from './analytics.repo.userRole'
import {
  buildCsrScopeCondition,
  buildDepartmentScopeCondition,
  buildFormScopeCondition,
  joinConditions,
} from './analytics.repo.where'
import {
  calculateCategoryScore,
  calculateQuestionScore,
  loadRadioOptionsByQuestion,
} from './analytics.repo.scoring'
import {
  selectCategoryLevelRows,
  selectDefaultRows,
  selectFormCategoryBreakdownRows,
  selectFormLevelRows,
  selectQuestionBreakdownRows,
  selectQuestionLevelRows,
} from './analytics.repo.submissions.queries'

interface DetectedShape {
  isQuestionLevel: boolean
  isCategoryLevel: boolean
  isFormLevelOnly: boolean
  includeQuestionBreakdown: boolean
  includeCategoryBreakdown: boolean
}

function detectFilterShape(filters: any): DetectedShape {
  const hasQuestionId = ('question_id' in filters && filters.question_id) ||
    ('questionIds' in filters && filters.questionIds?.length > 0)
  const hasCategoryId = ('category_id' in filters && filters.category_id) ||
    ('categoryIds' in filters && filters.categoryIds?.length > 0)
  const hasFormId = ('form_id' in filters && filters.form_id) ||
    ('formIds' in filters && filters.formIds?.length > 0)

  return {
    isQuestionLevel: !!hasQuestionId,
    isCategoryLevel: !!hasCategoryId && !hasQuestionId,
    isFormLevelOnly: !!hasFormId && !hasCategoryId && !hasQuestionId,
    includeQuestionBreakdown: !!filters.includeQuestionBreakdown,
    includeCategoryBreakdown: !!filters.includeCategoryBreakdown,
  }
}

function buildExtraConditions(
  filters: any,
  user_id: number,
  role: string | undefined,
  shape: DetectedShape,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    buildDepartmentScopeCondition(filters, user_id, role, {
      column: 'csr_user.department_id',
      allowNull: true,
    }),
    buildFormScopeCondition(filters),
    buildCsrScopeCondition(filters, { allowNull: true }),
  ]

  // Category scope: when the caller asked for category-level output
  // we can join `fc` directly; otherwise emit an EXISTS fragment.
  const useDirectCategoryJoin = shape.isCategoryLevel || shape.includeQuestionBreakdown
  if ('categoryIds' in filters && Array.isArray(filters.categoryIds) && filters.categoryIds.length > 0) {
    conditions.push(useDirectCategoryJoin
      ? Prisma.sql`AND fc.id IN (${Prisma.join(filters.categoryIds)})`
      : Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          INNER JOIN form_questions fq ON sa.question_id = fq.id
          WHERE sa.submission_id = s.id AND fq.category_id IN (${Prisma.join(filters.categoryIds)})
        )`)
  } else if ('category_id' in filters && filters.category_id) {
    conditions.push(useDirectCategoryJoin
      ? Prisma.sql`AND fc.id = ${filters.category_id}`
      : Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          INNER JOIN form_questions fq ON sa.question_id = fq.id
          WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
        )`)
  }

  if ('questionIds' in filters && Array.isArray(filters.questionIds) && filters.questionIds.length > 0) {
    conditions.push(shape.isQuestionLevel
      ? Prisma.sql`AND fq.id IN (${Prisma.join(filters.questionIds)})`
      : Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          WHERE sa.submission_id = s.id AND sa.question_id IN (${Prisma.join(filters.questionIds)})
        )`)
  } else if ('question_id' in filters && filters.question_id) {
    conditions.push(shape.isQuestionLevel
      ? Prisma.sql`AND fq.id = ${filters.question_id}`
      : Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
        )`)
  }

  return conditions
}

async function dispatchBranchQuery(
  filters: any,
  shape: DetectedShape,
  startDate: string | Date,
  endDateWithTime: string,
  scoreFilter: Prisma.Sql,
  extraWhere: Prisma.Sql,
): Promise<any[]> {
  const args = { startDate, endDateWithTime, scoreFilter, extraWhere }
  if (shape.isQuestionLevel) return selectQuestionLevelRows(args)
  if (shape.includeQuestionBreakdown && !filters.question_id) return selectQuestionBreakdownRows(args)
  if (shape.isCategoryLevel) return selectCategoryLevelRows(args)
  if (shape.isFormLevelOnly && shape.includeCategoryBreakdown) return selectFormCategoryBreakdownRows(args)
  if (shape.isFormLevelOnly) return selectFormLevelRows(args)
  return selectDefaultRows(args)
}

async function shapeQuestionLevelRows(rows: any[]): Promise<any[]> {
  const questionIds = [...new Set(rows.map(r => r.question_id))] as number[]
  const radioOptionsMap = await loadRadioOptionsByQuestion(questionIds)
  return Promise.all(rows.map(async (row: any) => {
    const questionAnswerValue = calculateQuestionScore(
      row,
      row.question_answer,
      radioOptionsMap[row.question_id] || [],
    )
    const categoryScore = await calculateCategoryScore(row.submission_id, row.category_id)
    return {
      submission_id: row.submission_id,
      submission_date: row.submission_date,
      csr_name: row.csr_name,
      form_name: row.form_name,
      total_score: parseFloat(row.total_score) || 0,
      category_name: row.category_name,
      category_id: row.category_id,
      category_score: categoryScore,
      question_text: row.question_text,
      question: row.question_text,
      question_answer: row.question_answer || 'N/A',
      question_answer_value: questionAnswerValue !== null ? questionAnswerValue : 0,
      responses: row.responses || 0,
      question_average_score: parseFloat(row.question_average_score) || 0,
    }
  }))
}

async function shapeQuestionBreakdownRows(rows: any[]): Promise<any[]> {
  return Promise.all(rows.map(async (row: any) => {
    const categoryScore = await calculateCategoryScore(row.submission_id, row.category_id)
    return {
      submission_id: row.submission_id,
      submission_date: row.submission_date,
      csr_name: row.csr_name,
      form_name: row.form_name,
      total_score: parseFloat(row.total_score) || 0,
      category_name: row.category_name,
      category_id: row.category_id,
      category_score: categoryScore,
      question_id: row.question_id,
      question_text: row.question_text,
      question: row.question_text,
      question_answer: row.question_answer || 'N/A',
      question_answer_value: row.question_answer_value !== null ? parseFloat(row.question_answer_value) : 0,
    }
  }))
}

function shapeCategoryRows(rows: any[]): any[] {
  return rows.map((row: any) => ({
    submission_id: row.submission_id,
    submission_date: row.submission_date,
    csr_name: row.csr_name,
    form_name: row.form_name,
    total_score: parseFloat(row.total_score) || 0,
    category_name: row.category_name,
    category_id: row.category_id,
    category_score: row.category_score != null ? parseFloat(row.category_score) : null,
    responses: row.responses || 0,
    average_score: row.average_score != null ? parseFloat(row.average_score) : null,
    category_possible_points: parseFloat(row.category_possible_points) || 0,
    category_earned_points: parseFloat(row.category_earned_points) || 0,
  }))
}

function shapeFormLevelRows(rows: any[]): any[] {
  return rows.map((row: any) => ({
    submission_id: row.submission_id,
    submission_date: row.submission_date,
    csr_name: row.csr_name,
    form_name: row.form_name,
    total_score: parseFloat(row.total_score) || 0,
  }))
}

function shapeDefaultRows(rows: any[]): any[] {
  return rows.map((row: any) => ({
    submission_id: row.submission_id,
    submission_date: row.submission_date,
    total_score: parseFloat(row.total_score) || 0,
    status: row.status,
    submitted_at: row.submitted_at,
    form_id: row.form_id,
    form_name: row.form_name,
    csr_id: row.csr_id,
    csr_name: row.csr_name,
    department_id: row.department_id,
    department_name: row.department_name,
    qa_id: row.qa_id,
    qa_name: row.qa_name,
  }))
}

export async function getDetailedSubmissionDataRepo(
  filters: any,
  user_id: number,
  userRole?: string,
): Promise<any[]> {
  try {
    const role = await resolveAnalyticsUserRole(user_id, userRole)
    const shape = detectFilterShape(filters)
    const useScoredFilter = !(
      ('category_id' in filters && filters.category_id) ||
      ('question_id' in filters && filters.question_id)
    )
    const scoreFilter = useScoredFilter ? Prisma.sql`AND s.total_score IS NOT NULL` : Prisma.sql``
    const endDateWithTime = `${filters.end_date} 23:59:59`

    const extraWhere = joinConditions(buildExtraConditions(filters, user_id, role, shape))
    const rows = await dispatchBranchQuery(filters, shape, filters.start_date, endDateWithTime, scoreFilter, extraWhere)

    if (shape.isQuestionLevel) return shapeQuestionLevelRows(rows)
    if (shape.includeQuestionBreakdown && !filters.question_id) return shapeQuestionBreakdownRows(rows)
    if (shape.isCategoryLevel) return shapeCategoryRows(rows)
    if (shape.isFormLevelOnly && shape.includeCategoryBreakdown) return shapeCategoryRows(rows)
    if (shape.isFormLevelOnly) return shapeFormLevelRows(rows)
    return shapeDefaultRows(rows)
  } catch (error) {
    logger.error('Error fetching detailed submission data:', error)
    throw new Error('Failed to fetch detailed submission data')
  }
}

import logger from '../../config/logger';