/**
 * Performance-goal evaluation service.
 *
 * Extracted from the legacy `AnalyticsService.getPerformanceGoals(...)`
 * during pre-production cleanup item #29. Each goal type
 * (`QA_SCORE`, `AUDIT_RATE`, `DISPUTE_RATE`) maps to its own metric
 * resolver — unknown types are skipped to mirror the legacy behaviour.
 */

import type { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import type {
  ReportFilters,
  PerformanceGoalData,
} from '../../types/analytics.types'
import type cacheService from '../CacheService'
import {
  ANALYTICS_GOALS_CACHE_TTL_SECONDS,
  generateAnalyticsCacheKey,
} from './analytics.cache'
import { calculatePercentComplete } from './analytics.statistics'
import { AnalyticsServiceError } from './analytics.types'
import { validateAnalyticsDateRange } from './analytics.validation'

type CacheService = typeof cacheService

async function calculateMetric(
  repository: IAnalyticsRepository,
  filters: ReportFilters,
  user_id: number,
  userRole: string | undefined,
  goal: any,
): Promise<number | null> {
  switch (goal.goal_type) {
    case 'QA_SCORE': {
      const scoreData = await repository.getAverageQAScore(filters, user_id, userRole, goal)
      return scoreData.averageScore || 0
    }
    case 'AUDIT_RATE': {
      const auditData = await repository.getAuditRateData(filters, user_id, userRole, goal)
      return auditData.auditRate || 0
    }
    case 'DISPUTE_RATE': {
      const disputeData = await repository.getDisputeRateData(filters, user_id, userRole, goal)
      return disputeData.disputeRate || 0
    }
    default:
      return null
  }
}

export async function getPerformanceGoals(
  repository: IAnalyticsRepository,
  cache: CacheService,
  filters: ReportFilters,
  user_id: number,
  userRole?: string,
): Promise<PerformanceGoalData[]> {
  try {
    validateAnalyticsDateRange(filters)
    const cacheKey = generateAnalyticsCacheKey('performance-goals', filters, user_id, userRole)

    const cached = await cache.get<PerformanceGoalData[]>(cacheKey)
    if (cached) return cached

    const goals = await repository.getActiveGoals(user_id, userRole, filters.department_id)
    const performanceData: PerformanceGoalData[] = []

    for (const goal of goals) {
      const actualValue = await calculateMetric(repository, filters, user_id, userRole, goal)
      if (actualValue === null) continue

      performanceData.push({
        goal_type: goal.goal_type,
        target_value: goal.target_value,
        actualValue,
        percentComplete: calculatePercentComplete(actualValue, goal.target_value),
      })
    }

    await cache.set(cacheKey, performanceData, ANALYTICS_GOALS_CACHE_TTL_SECONDS)
    return performanceData
  } catch (error: any) {
    if (error instanceof AnalyticsServiceError) throw error
    throw new AnalyticsServiceError(
      `Failed to get performance goals: ${error?.message ?? error}`,
      500,
      'PERFORMANCE_GOALS_ERROR',
    )
  }
}
