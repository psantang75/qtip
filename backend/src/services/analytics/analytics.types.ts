/**
 * Analytics service — shared types.
 *
 * Decomposed from the legacy `services/AnalyticsService.ts` god file
 * during pre-production cleanup item #29. Centralises the public DTOs
 * and the domain-specific error class so every analytics submodule
 * (filters / trends / goals / report / export) speaks one language.
 */

/**
 * Filter options surfaced to the analytics UI by `GET /api/analytics/filters`.
 *
 * The legacy `datePresets` array (`last7days` / `thisMonth` / `lastQuarter` …)
 * was removed during the pre-production review (item #25). It was a dead
 * field — `qaService.getAnalyticsFilters()` only destructures
 * `{ departments, csrs, forms }` — and it duplicated the canonical period
 * vocabulary defined in `utils/periodUtils.ts` (`current_week`, `prior_week`,
 * `current_month`, `prior_month`, `current_quarter`, `prior_quarter`,
 * `current_year`, `prior_year`, `custom`). All new code must resolve periods
 * via `resolvePeriod(...)` so QC, on-demand reports, and analytics share one
 * date language.
 */
export interface FilterOptions {
  departments: any[]
  forms: any[]
  csrs: any[]
}

/**
 * Domain-specific error mirrored on the legacy `AnalyticsServiceError`
 * shape. The route layer (`routes/analytics.routes.ts`) uses the
 * `statusCode` + `code` envelope when serialising failures.
 */
export class AnalyticsServiceError extends Error {
  public statusCode: number
  public code: string

  constructor(
    message: string,
    statusCode = 500,
    code = 'ANALYTICS_ERROR',
  ) {
    super(message)
    this.name = 'AnalyticsServiceError'
    this.statusCode = statusCode
    this.code = code
  }
}
