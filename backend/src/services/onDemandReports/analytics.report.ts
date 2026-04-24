/**
 * "QA Analytics — Raw Scores" on-demand report.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * Produces one row per submission/category/question, matching the
 * `QTIP_AnalyticsReport_*.xlsx` reference workbook. Pagination
 * resolves answer verbiage only on the visible page slice to keep
 * paging snappy; the Excel download resolves verbiage for every
 * matching row and additionally surfaces the always-numeric
 * `question_total_value` column.
 */

import {
  applySubmissionIdFilter,
  getAnalyticsRepository,
  getAnalyticsService,
  resolveCsrIds,
  resolveDepartmentIds,
  resolveFormIds,
  timestampedFilename,
} from './helpers'
import { augmentAnalyticsRowsWithAnswerText } from './analytics.value'
import type {
  OnDemandReport,
  OnDemandReportColumn,
  OnDemandReportFilters,
} from './types'

const analyticsColumns: OnDemandReportColumn[] = [
  { key: 'submission_id', label: 'Submission ID' },
  { key: 'submission_date', label: 'Date' },
  { key: 'csr_name', label: 'CSR' },
  { key: 'form_name', label: 'Form' },
  { key: 'total_score', label: 'Form Score', align: 'right', format: 'percent' },
  { key: 'category_name', label: 'Category' },
  { key: 'category_score', label: 'Category Score', align: 'right', format: 'percent' },
  { key: 'question_text', label: 'Question' },
  { key: 'question_answer', label: 'Answer' },
  { key: 'question_value', label: 'Value' },
]

/**
 * Resolves the analytics filter shape that gets passed into
 * `getDetailedSubmissionData`. `includeQuestionBreakdown: true` is
 * what makes the repo join through to category + question rows
 * (otherwise we only get one submission-level row).
 */
async function buildAnalyticsRepoFilters(
  filters: OnDemandReportFilters,
): Promise<Record<string, unknown>> {
  const [departmentIds, formIds, csrIds] = await Promise.all([
    resolveDepartmentIds(filters.departments),
    resolveFormIds(filters.forms),
    resolveCsrIds(filters.agents),
  ])

  const repoFilters: Record<string, unknown> = {
    start_date: filters.start_date,
    end_date: filters.end_date,
    includeQuestionBreakdown: true,
  }
  if (departmentIds.length > 0) repoFilters.departmentIds = departmentIds
  if (formIds.length > 0) repoFilters.formIds = formIds
  if (csrIds.length > 0) repoFilters.csrIds = csrIds
  return repoFilters
}

function formatAnalyticsRow(row: any): Record<string, unknown> {
  const date = row.submission_date
    ? (row.submission_date instanceof Date
        ? row.submission_date.toISOString().split('T')[0]
        : String(row.submission_date).split('T')[0])
    : ''
  return {
    submission_id: row.submission_id ?? '',
    submission_date: date,
    csr_name: row.csr_name ?? '',
    form_name: row.form_name ?? '',
    total_score: row.total_score != null ? Number(row.total_score) : null,
    category_name: row.category_name ?? '',
    category_score: row.category_score != null ? Number(row.category_score) : null,
    question_text: row.question_text ?? row.question ?? '',
    question_answer: row.question_answer ?? '',
    question_value: row.question_value !== undefined && row.question_value !== null
      ? row.question_value
      : '',
  }
}

export const analyticsRawScoresReport: OnDemandReport = {
  id: 'analytics-raw-scores',
  name: 'QA Analytics - Raw Scores',
  description:
    'Detailed quality scores for the selected date range. One row per submission/category/question, ' +
    'matching the data in the QA Analytics export workbook.',
  roles: [1, 5],
  columns: analyticsColumns,
  supportedFilters: ['period', 'departments', 'forms', 'agents', 'submissionId'],
  async getRows(filters, user, page) {
    const repoFilters = await buildAnalyticsRepoFilters(filters)
    const repo = getAnalyticsRepository()
    const allRowsRaw: any[] = await repo.getDetailedSubmissionData(
      repoFilters, user.user_id, user.role,
    )
    const filteredRaw = applySubmissionIdFilter(allRowsRaw, filters.submissionId)
    const total = filteredRaw.length
    const start = (page.page - 1) * page.pageSize
    const pageSlice = filteredRaw.slice(start, start + page.pageSize)
    const augmented = await augmentAnalyticsRowsWithAnswerText(pageSlice)
    return { rows: augmented.map(formatAnalyticsRow), total }
  },
  async getXlsx(filters, user) {
    const repoFilters = await buildAnalyticsRepoFilters(filters)
    const svc = getAnalyticsService()
    const repo = getAnalyticsRepository()

    // Always go through the row-based exporter so the workbook
    // matches the on-screen view (resolved Answer verbiage + Value).
    const allRowsRaw: any[] = await repo.getDetailedSubmissionData(
      repoFilters, user.user_id, user.role,
    )
    const filtered = applySubmissionIdFilter(allRowsRaw, filters.submissionId)
    const augmented = await augmentAnalyticsRowsWithAnswerText(filtered, {
      includeTotalValue: true,
    })
    const buffer = await svc.buildComprehensiveExportFromRows(augmented)
    return { buffer, filename: timestampedFilename('AnalyticsReport') }
  },
}
