/**
 * Analytics export service.
 *
 * Extracted from the legacy `AnalyticsService.exportQAScores(...)` /
 * `exportComprehensiveReport(...)` / `buildComprehensiveExportFromRows(...)`
 * during pre-production cleanup item #29. Each entry point validates
 * the date range, fetches the appropriate row set from the
 * repository, and then defers to the workbook builder so all three
 * exports produce a consistent layout.
 */

import type { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import type {
  ReportFilters,
  ComprehensiveReportFilters,
} from '../../types/analytics.types'
import { generateAnalyticsExcel } from './analytics.export.builder'
import { AnalyticsServiceError } from './analytics.types'
import { validateAnalyticsDateRange } from './analytics.validation'

function ensureDateBounds(
  filters: ReportFilters | ComprehensiveReportFilters,
): void {
  validateAnalyticsDateRange(filters)
  if (!filters.start_date || !filters.end_date) {
    throw new AnalyticsServiceError(
      'Start date and end date are required',
      400,
      'INVALID_DATE_RANGE',
    )
  }
}

export async function exportQAScores(
  repository: IAnalyticsRepository,
  filters: ReportFilters,
  user_id: number,
  userRole?: string,
): Promise<Buffer> {
  try {
    ensureDateBounds(filters)
    const rawData = await repository.getDetailedQAScoreData(filters, user_id, userRole)
    return await generateAnalyticsExcel(rawData)
  } catch (error: any) {
    if (error instanceof AnalyticsServiceError) throw error
    throw new AnalyticsServiceError(
      `Failed to export QA scores: ${error?.message ?? error}`,
      500,
      'QA_SCORE_EXPORT_ERROR',
    )
  }
}

export async function exportComprehensiveReport(
  repository: IAnalyticsRepository,
  filters: ComprehensiveReportFilters,
  user_id: number,
  userRole?: string,
): Promise<Buffer> {
  try {
    ensureDateBounds(filters)
    const rawData = await repository.getDetailedSubmissionData(filters, user_id, userRole)
    return await generateAnalyticsExcel(rawData)
  } catch (error: any) {
    if (error instanceof AnalyticsServiceError) throw error
    throw new AnalyticsServiceError(
      `Failed to export comprehensive report: ${error?.message ?? error}`,
      500,
      'COMPREHENSIVE_REPORT_EXPORT_ERROR',
    )
  }
}

/**
 * Build the comprehensive xlsx workbook from a pre-fetched row set.
 *
 * Used by callers (e.g. on-demand reports) that need to apply
 * post-fetch filters before generating the workbook so the download
 * stays in sync with what the user is seeing on screen.
 */
export async function buildComprehensiveExportFromRows(
  rows: any[],
): Promise<Buffer> {
  return generateAnalyticsExcel(rows)
}
