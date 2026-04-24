/**
 * Analytics cache utilities.
 *
 * Extracted from the legacy `AnalyticsService` god class during
 * pre-production cleanup item #29. Centralises the cache-key
 * derivation so every analytics submodule produces consistent keys.
 *
 * The cache layer itself (TTL map) lives in `services/CacheService.ts` —
 * see pre-production cleanup item #22 for the broader cache-service
 * consolidation work.
 */

import type {
  ReportFilters,
  ComprehensiveReportFilters,
} from '../../types/analytics.types'

/** Default TTL (seconds) for analytics cache entries. */
export const ANALYTICS_CACHE_TTL_SECONDS = 300

/** TTL for filter options (changes infrequently). */
export const ANALYTICS_FILTERS_CACHE_TTL_SECONDS = 600

/** TTL for goal performance (more dynamic). */
export const ANALYTICS_GOALS_CACHE_TTL_SECONDS = 180

type AnalyticsFilters = ReportFilters | ComprehensiveReportFilters

/**
 * Build a stable, namespaced cache key for analytics queries.
 *
 * Keys look like `analytics:<type>:<user_id>:<role>:<hash>` so each user/role
 * pair gets its own slice of the cache.
 */
export function generateAnalyticsCacheKey(
  type: string,
  filters: AnalyticsFilters,
  user_id: number,
  userRole: string | undefined,
): string {
  return `analytics:${type}:${user_id}:${userRole}:${hashAnalyticsFilters(filters)}`
}

/**
 * Compact base-36 hash of the salient filter fields.
 *
 * Implementation mirrors the legacy in-class helper — kept simple on
 * purpose because cache collisions only manifest as a stale read for
 * the same user/role pair, which the TTL clears within minutes.
 */
export function hashAnalyticsFilters(filters: AnalyticsFilters): string {
  const keyString = JSON.stringify({
    start_date: filters.start_date,
    end_date: filters.end_date,
    department_id:
      'department_id' in filters ? filters.department_id : undefined,
    departmentIds:
      'departmentIds' in filters ? filters.departmentIds?.slice().sort() : undefined,
    csrIds: filters.csrIds?.slice().sort(),
    form_id: filters.form_id,
    category_id:
      'category_id' in filters ? filters.category_id : undefined,
    question_id:
      'question_id' in filters ? filters.question_id : undefined,
  })

  let hash = 0
  for (let i = 0; i < keyString.length; i += 1) {
    const char = keyString.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash &= hash
  }
  return Math.abs(hash).toString(36)
}
