/**
 * Filter-options service.
 *
 * Wraps the repository call with caching. Extracted from the legacy
 * `AnalyticsService.getFilterOptions(...)` during pre-production
 * cleanup item #29 so the cache wiring is testable in isolation.
 */

import type { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import type cacheService from '../CacheService'
import {
  ANALYTICS_FILTERS_CACHE_TTL_SECONDS,
} from './analytics.cache'
import { AnalyticsServiceError, FilterOptions } from './analytics.types'

type CacheService = typeof cacheService

export async function getAnalyticsFilterOptions(
  repository: IAnalyticsRepository,
  cache: CacheService,
  user_id: number,
  userRole?: string,
): Promise<FilterOptions> {
  try {
    const cacheKey = `analytics:filters:${user_id}:${userRole}`

    const cached = await cache.get<FilterOptions>(cacheKey)
    if (cached) return cached

    const filters = await repository.getFilterOptions(user_id, userRole)
    await cache.set(cacheKey, filters, ANALYTICS_FILTERS_CACHE_TTL_SECONDS)
    return filters
  } catch (error: any) {
    throw new AnalyticsServiceError(
      `Failed to get filter options: ${error?.message ?? error}`,
      500,
      'FILTER_OPTIONS_ERROR',
    )
  }
}
