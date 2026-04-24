/**
 * QA score trends + distribution service.
 *
 * Extracted from the legacy `AnalyticsService` during pre-production
 * cleanup item #29. Both endpoints share the same cached / validated
 * raw-score query, just differing in the aggregation step
 * (trend grouping vs distribution buckets).
 */

import type { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import type {
  ReportFilters,
  QAScoreTrendResponse,
  ScoreDistributionResponse,
} from '../../types/analytics.types'
import type cacheService from '../CacheService'
import {
  ANALYTICS_CACHE_TTL_SECONDS,
  generateAnalyticsCacheKey,
} from './analytics.cache'
import {
  aggregateScoreTrends,
  calculateOverallMetrics,
  calculateScoreDistribution,
} from './analytics.statistics'
import { AnalyticsServiceError } from './analytics.types'
import { validateAnalyticsDateRange } from './analytics.validation'

type CacheService = typeof cacheService

export async function getQAScoreTrends(
  repository: IAnalyticsRepository,
  cache: CacheService,
  filters: ReportFilters,
  user_id: number,
  userRole?: string,
): Promise<QAScoreTrendResponse> {
  try {
    validateAnalyticsDateRange(filters)
    const cacheKey = generateAnalyticsCacheKey('qa-score-trends', filters, user_id, userRole)

    const cached = await cache.get<QAScoreTrendResponse>(cacheKey)
    if (cached) return cached

    const rawData = await repository.getQAScoreData(filters, user_id, userRole)
    const result: QAScoreTrendResponse = {
      trends: aggregateScoreTrends(rawData, 'csr'),
      overall: calculateOverallMetrics(rawData),
    }

    await cache.set(cacheKey, result, ANALYTICS_CACHE_TTL_SECONDS)
    return result
  } catch (error: any) {
    if (error instanceof AnalyticsServiceError) throw error
    throw new AnalyticsServiceError(
      `Failed to get QA score trends: ${error?.message ?? error}`,
      500,
      'QA_SCORE_TRENDS_ERROR',
    )
  }
}

export async function getQAScoreDistribution(
  repository: IAnalyticsRepository,
  cache: CacheService,
  filters: ReportFilters,
  user_id: number,
  userRole?: string,
): Promise<ScoreDistributionResponse> {
  try {
    validateAnalyticsDateRange(filters)
    const cacheKey = generateAnalyticsCacheKey('qa-score-distribution', filters, user_id, userRole)

    const cached = await cache.get<ScoreDistributionResponse>(cacheKey)
    if (cached) return cached

    const rawData = await repository.getQAScoreData(filters, user_id, userRole)
    const result: ScoreDistributionResponse = {
      distributions: calculateScoreDistribution(rawData),
      totalAudits: rawData.length,
    }

    await cache.set(cacheKey, result, ANALYTICS_CACHE_TTL_SECONDS)
    return result
  } catch (error: any) {
    if (error instanceof AnalyticsServiceError) throw error
    throw new AnalyticsServiceError(
      `Failed to get QA score distribution: ${error?.message ?? error}`,
      500,
      'QA_SCORE_DISTRIBUTION_ERROR',
    )
  }
}
