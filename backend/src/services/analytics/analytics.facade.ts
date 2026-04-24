/**
 * Analytics service facade.
 *
 * Thin coordinator that wires the dependency-injected repository +
 * cache through the modular helpers in `services/analytics/*`. The
 * public API (constructor, method names, return shapes) matches the
 * legacy god class exactly so callers in
 * `routes/analytics.routes.ts` and `services/onDemandReportsRegistry.ts`
 * keep working unchanged.
 *
 * Decomposed during pre-production cleanup item #29.
 */

import type { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import type {
  ReportFilters,
  ComprehensiveReportFilters,
  QAScoreTrendResponse,
  ScoreDistributionResponse,
  PerformanceGoalData,
} from '../../types/analytics.types'
import cacheService from '../CacheService'
import { getAnalyticsFilterOptions } from './analytics.filters.service'
import { getQAScoreTrends, getQAScoreDistribution } from './analytics.trends.service'
import { getPerformanceGoals } from './analytics.performanceGoals.service'
import { getComprehensiveReport } from './analytics.report.service'
import {
  exportQAScores,
  exportComprehensiveReport,
  buildComprehensiveExportFromRows,
} from './analytics.export.service'
import type { FilterOptions } from './analytics.types'

type CacheService = typeof cacheService

export class AnalyticsService {
  private readonly repository: IAnalyticsRepository
  private readonly cache: CacheService

  constructor(
    repository: IAnalyticsRepository,
    providedCacheService?: CacheService,
  ) {
    this.repository = repository
    this.cache = providedCacheService ?? cacheService
  }

  getFilterOptions(user_id: number, userRole?: string): Promise<FilterOptions> {
    return getAnalyticsFilterOptions(this.repository, this.cache, user_id, userRole)
  }

  getQAScoreTrends(
    filters: ReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<QAScoreTrendResponse> {
    return getQAScoreTrends(this.repository, this.cache, filters, user_id, userRole)
  }

  getQAScoreDistribution(
    filters: ReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<ScoreDistributionResponse> {
    return getQAScoreDistribution(this.repository, this.cache, filters, user_id, userRole)
  }

  getPerformanceGoals(
    filters: ReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<PerformanceGoalData[]> {
    return getPerformanceGoals(this.repository, this.cache, filters, user_id, userRole)
  }

  exportQAScores(
    filters: ReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<Buffer> {
    return exportQAScores(this.repository, filters, user_id, userRole)
  }

  exportComprehensiveReport(
    filters: ComprehensiveReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<Buffer> {
    return exportComprehensiveReport(this.repository, filters, user_id, userRole)
  }

  buildComprehensiveExportFromRows(rows: any[]): Promise<Buffer> {
    return buildComprehensiveExportFromRows(rows)
  }

  getComprehensiveReport(
    filters: ComprehensiveReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<any> {
    return getComprehensiveReport(this.repository, filters, user_id, userRole)
  }

  /**
   * Invalidate cache.
   *
   * The legacy implementation always called `flushAll()` regardless of
   * the `pattern` argument — kept as-is to preserve behaviour. See
   * pre-production cleanup item #22 for the broader cache-service
   * consolidation work that will replace this with pattern-scoped
   * invalidation.
   */
  async invalidateCache(_pattern?: string): Promise<void> {
    try {
      this.cache.flushAll()
    } catch {
      // Cache invalidation failure is non-critical.
    }
  }
}
