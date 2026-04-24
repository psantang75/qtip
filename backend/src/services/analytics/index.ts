/**
 * Analytics service barrel.
 *
 * Single import surface for the analytics domain. Created during
 * pre-production cleanup item #29 when the legacy
 * `services/AnalyticsService.ts` god class was decomposed.
 */

export { AnalyticsService } from './analytics.facade'
export { AnalyticsServiceError, type FilterOptions } from './analytics.types'
