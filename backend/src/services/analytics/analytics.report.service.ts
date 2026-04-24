/**
 * Comprehensive report service.
 *
 * Extracted from the legacy `AnalyticsService.getComprehensiveReport(...)`,
 * `getRawScoresReport(...)` and `getSummaryReport(...)` during
 * pre-production cleanup item #29. The bulk of the file is the
 * statistics-selection logic for raw scores: when a question or
 * category filter is in play, statistics are taken from the matching
 * breakdown row instead of the form-level aggregate.
 */

import type { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import type { ComprehensiveReportFilters } from '../../types/analytics.types'
import {
  calculateRawScoreStatistics,
  calculateScoreDistribution,
  getEmptyStatistics,
} from './analytics.statistics'
import { AnalyticsServiceError } from './analytics.types'
import { validateAnalyticsDateRange } from './analytics.validation'

type Statistics = ReturnType<typeof getEmptyStatistics>

/**
 * Build a category-percentage statistics envelope (single point of
 * data — min/max/median collapse to the percentage).
 */
function statsFromCategoryPercentage(category: any): Statistics {
  const pct = Number(category.category_percentage)
  return {
    count: category.total_responses,
    mean: pct,
    median: pct,
    mode: pct,
    standardDeviation: 0,
    min: pct,
    max: pct,
    percentiles: { p25: pct, p50: pct, p75: pct, p90: pct, p95: pct },
  }
}

function findMatchingQuestion(filters: any, questions: any[] | undefined): any | undefined {
  if (!questions) return undefined
  return questions.find(q => {
    if (filters.questionIds?.length > 0) {
      return filters.questionIds.some((id: number) =>
        q.question_ids?.includes(id) || Number(q.question_id) === Number(id),
      )
    }
    if (filters.question_id) {
      return Number(q.question_id) === Number(filters.question_id)
    }
    return false
  })
}

function findMatchingCategory(filters: any, categories: any[] | undefined): any | undefined {
  if (!categories) return undefined
  return categories.find(c => {
    if (filters.categoryIds?.length > 0) {
      return filters.categoryIds.some((id: number) =>
        c.category_ids?.includes(id) || c.category_id === id,
      )
    }
    if (filters.category_id) {
      return c.category_id === filters.category_id
        || (c.category_ids && c.category_ids.includes(filters.category_id))
    }
    return false
  })
}

async function getRawScoresReport(
  repository: IAnalyticsRepository,
  filters: any,
  user_id: number,
  userRole?: string,
): Promise<any> {
  const rawData = await repository.getDetailedSubmissionData(filters, user_id, userRole)

  const wantsCategory = filters.includeCategoryBreakdown
    || filters.category_id || filters.categoryIds
    || filters.question_id || filters.questionIds
  const categoryBreakdown = wantsCategory
    ? await repository.getCategoryLevelAnalytics(filters)
    : null

  const wantsQuestion = filters.includeQuestionBreakdown
    || filters.question_id || filters.questionIds
  const questionBreakdown = wantsQuestion
    ? await repository.getQuestionLevelAnalytics(filters)
    : null

  // Form-level statistics are always computed against the unfiltered
  // (form-only) row set so the headline numbers reflect the form, not
  // the slice the user filtered down to.
  const formLevelFilters: any = { ...filters }
  delete formLevelFilters.category_id
  delete formLevelFilters.categoryIds
  delete formLevelFilters.question_id
  delete formLevelFilters.questionIds

  const fullFormData = await repository.getDetailedSubmissionData(
    formLevelFilters, user_id, userRole,
  )
  const formLevelStatistics = calculateRawScoreStatistics(fullFormData)

  let specificLevelStatistics: Statistics | undefined
  let categoryLevelStatistics: Statistics | undefined

  const hasQuestionFilter = filters.questionIds?.length > 0 || filters.question_id

  if (hasQuestionFilter && questionBreakdown) {
    const question = findMatchingQuestion(filters, questionBreakdown.questions)
    if (question && question.average_score !== null) {
      const score = question.average_score
      specificLevelStatistics = {
        count: question.total_responses,
        mean: score,
        median: score,
        mode: score,
        standardDeviation: question.score_std_dev || 0,
        min: question.min_score || 0,
        max: question.max_score || 0,
        percentiles: {
          p25: question.min_score || 0,
          p50: score,
          p75: question.max_score || 0,
          p90: question.max_score || 0,
          p95: question.max_score || 0,
        },
      }
    } else {
      specificLevelStatistics = getEmptyStatistics()
    }

    if (categoryBreakdown) {
      const category = findMatchingCategory(filters, categoryBreakdown.categories)
      if (category && category.category_percentage !== null) {
        categoryLevelStatistics = statsFromCategoryPercentage(category)
      }
    }
  } else if ((filters.categoryIds?.length > 0 || filters.category_id) && categoryBreakdown) {
    const category = findMatchingCategory(filters, categoryBreakdown.categories)
    specificLevelStatistics = (category && category.category_percentage !== null)
      ? statsFromCategoryPercentage(category)
      : getEmptyStatistics()
  } else {
    specificLevelStatistics = formLevelStatistics
  }

  return {
    submissions: rawData,
    totalCount: rawData.length,
    questionBreakdown: filters.includeQuestionBreakdown ? questionBreakdown : null,
    categoryBreakdown: filters.includeCategoryBreakdown ? categoryBreakdown : null,
    statistics: formLevelStatistics,
    specificLevelStatistics,
    categoryLevelStatistics: categoryLevelStatistics ?? null,
  }
}

async function getSummaryReport(
  repository: IAnalyticsRepository,
  filters: any,
  user_id: number,
  userRole?: string,
): Promise<any> {
  const rawData = await repository.getQAScoreData(filters, user_id, userRole)

  // Strip breakdown flags so the detailed query returns one row per
  // submission rather than one row per category/question combo.
  const summaryFilters: any = { ...filters }
  delete summaryFilters.includeCategoryBreakdown
  delete summaryFilters.includeQuestionBreakdown

  const detailedData = await repository.getDetailedSubmissionData(
    summaryFilters, user_id, userRole,
  )

  return {
    overview: { scoreDistribution: calculateScoreDistribution(rawData) },
    submissions: detailedData,
    totalCount: detailedData.length,
  }
}

export async function getComprehensiveReport(
  repository: IAnalyticsRepository,
  filters: ComprehensiveReportFilters,
  user_id: number,
  userRole?: string,
): Promise<any> {
  try {
    validateAnalyticsDateRange(filters)

    switch (filters.reportType) {
      case 'raw_scores':
        return await getRawScoresReport(repository, filters, user_id, userRole)
      case 'summary':
        return await getSummaryReport(repository, filters, user_id, userRole)
      default:
        throw new AnalyticsServiceError(
          `Invalid report type: ${filters.reportType}`,
          400,
          'INVALID_REPORT_TYPE',
        )
    }
  } catch (error: any) {
    if (error instanceof AnalyticsServiceError) throw error
    throw new AnalyticsServiceError(
      `Failed to generate comprehensive report: ${error?.message ?? error}`,
      500,
      'COMPREHENSIVE_REPORT_ERROR',
    )
  }
}
