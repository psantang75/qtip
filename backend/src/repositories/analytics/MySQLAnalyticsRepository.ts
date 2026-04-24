/**
 * Modular `MySQLAnalyticsRepository`.
 *
 * Thin facade that implements `IAnalyticsRepository` by delegating
 * to the focused per-method modules created during pre-production
 * cleanup item #29. The legacy implementation
 * (`backend/src/repositories/MySQLAnalyticsRepository.ts`) was a
 * 1,748-line god class — it now lives as a re-export shim and all
 * future maintenance happens in this directory.
 *
 * Layout:
 *  - `analytics.repo.userRole.ts`            — role lookup helper
 *  - `analytics.repo.where.ts`               — shared WHERE builders
 *  - `analytics.repo.scoring.ts`             — pure scoring helpers
 *  - `analytics.repo.filters.ts`             — getFilterOptions
 *  - `analytics.repo.scores.ts`              — getQAScoreData / getDetailedQAScoreData
 *  - `analytics.repo.goals.ts`               — getActiveGoals + 3 metric calcs
 *  - `analytics.repo.submissions.queries.ts` — branch SELECTs
 *  - `analytics.repo.submissions.ts`         — getDetailedSubmissionData orchestrator
 *  - `analytics.repo.questionLevel.ts`       — getQuestionLevelAnalytics
 *  - `analytics.repo.categoryLevel.ts`       — getCategoryLevelAnalytics
 */

import { IAnalyticsRepository } from '../../interfaces/IAnalyticsRepository'
import { ReportFilters, ComprehensiveReportFilters } from '../../types/analytics.types'
import { getAnalyticsFilterOptionsRepo } from './analytics.repo.filters'
import {
  getDetailedQAScoreDataRepo,
  getQAScoreDataRepo,
} from './analytics.repo.scores'
import {
  getActiveGoalsRepo,
  getAuditRateRepo,
  getAverageQAScoreRepo,
  getDisputeRateRepo,
} from './analytics.repo.goals'
import { getDetailedSubmissionDataRepo } from './analytics.repo.submissions'
import { getQuestionLevelAnalyticsRepo } from './analytics.repo.questionLevel'
import { getCategoryLevelAnalyticsRepo } from './analytics.repo.categoryLevel'

export class MySQLAnalyticsRepository implements IAnalyticsRepository {
  getFilterOptions(user_id: number, userRole?: string) {
    return getAnalyticsFilterOptionsRepo(user_id, userRole)
  }

  getQAScoreData(
    filters: ReportFilters | ComprehensiveReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<any[]> {
    return getQAScoreDataRepo(filters, user_id, userRole)
  }

  getDetailedQAScoreData(
    filters: ReportFilters | ComprehensiveReportFilters,
    user_id: number,
    userRole?: string,
  ): Promise<any[]> {
    return getDetailedQAScoreDataRepo(filters, user_id, userRole)
  }

  getDetailedSubmissionData(filters: any, user_id: number, userRole?: string): Promise<any[]> {
    return getDetailedSubmissionDataRepo(filters, user_id, userRole)
  }

  getQuestionLevelAnalytics(filters: any): Promise<any> {
    return getQuestionLevelAnalyticsRepo(filters)
  }

  getCategoryLevelAnalytics(filters: any): Promise<any> {
    return getCategoryLevelAnalyticsRepo(filters)
  }

  getActiveGoals(user_id: number, userRole?: string, department_id?: number): Promise<any[]> {
    return getActiveGoalsRepo(user_id, userRole, department_id)
  }

  getAverageQAScore(
    filters: ReportFilters,
    user_id: number,
    userRole: string | undefined,
    goal: any,
  ): Promise<{ averageScore: number }> {
    return getAverageQAScoreRepo(filters, user_id, userRole, goal)
  }

  getAuditRateData(
    filters: ReportFilters,
    user_id: number,
    userRole: string | undefined,
    goal: any,
  ): Promise<{ auditRate: number }> {
    return getAuditRateRepo(filters, user_id, userRole, goal)
  }

  getDisputeRateData(
    filters: ReportFilters,
    user_id: number,
    userRole: string | undefined,
    goal: any,
  ): Promise<{ disputeRate: number }> {
    return getDisputeRateRepo(filters, user_id, userRole, goal)
  }
}
