/**
 * Legacy import shim — `services/AnalyticsService.ts`.
 *
 * The original 1,290-line god class was decomposed during
 * pre-production cleanup item #29 into focused modules under
 * `services/analytics/*`. This file is preserved only so existing
 * imports (`import { AnalyticsService } from '../services/AnalyticsService'`)
 * keep working without churning every caller.
 *
 * Prefer importing from `services/analytics` in new code:
 *
 *   import { AnalyticsService, AnalyticsServiceError } from '../services/analytics'
 */

export { AnalyticsService, AnalyticsServiceError } from './analytics'
export type { FilterOptions } from './analytics'
