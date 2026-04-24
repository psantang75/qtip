/**
 * Analytics request validation.
 *
 * Extracted from the legacy `AnalyticsService` god class during
 * pre-production cleanup item #29. Centralises the date-range checks
 * so every entry point (trends / distribution / goals / report /
 * export) enforces the same contract.
 */

import type {
  ReportFilters,
  ComprehensiveReportFilters,
} from '../../types/analytics.types'
import { AnalyticsServiceError } from './analytics.types'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Reject requests that don't have a valid `start_date` ↔ `end_date`
 * window. Throws an `AnalyticsServiceError` with the existing JSON
 * envelope codes (`INVALID_DATE_RANGE` / `DATE_RANGE_TOO_LARGE`) so
 * the route layer can serialise the failure unchanged.
 */
export function validateAnalyticsDateRange(
  filters: ReportFilters | ComprehensiveReportFilters,
): void {
  if (!filters.start_date || !filters.end_date) {
    throw new AnalyticsServiceError(
      'Start date and end date are required',
      400,
      'INVALID_DATE_RANGE',
    )
  }

  const start = new Date(filters.start_date)
  const end = new Date(filters.end_date)

  if (start > end) {
    throw new AnalyticsServiceError(
      'Start date must be before end date',
      400,
      'INVALID_DATE_RANGE',
    )
  }

  if (end.getTime() - start.getTime() > ONE_YEAR_MS) {
    throw new AnalyticsServiceError(
      'Date range cannot exceed one year',
      400,
      'DATE_RANGE_TOO_LARGE',
    )
  }
}
