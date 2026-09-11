/**
 * Backward-compatible re-export shim.
 *
 * The original 797-line on-demand reports registry was decomposed
 * into focused per-report modules under
 * `backend/src/services/onDemandReports/` during pre-production
 * cleanup item #29 (god-files refactor). Existing import paths
 * continue to work via this shim — all new code should import from
 * the modular location.
 *
 * @see backend/src/services/onDemandReports/index.ts
 */
export {
  ON_DEMAND_REPORTS,
  getOnDemandReport,
  listOnDemandReportsForRole,
  getOnDemandFilterOptions,
  XLSX_CONTENT_TYPE,
} from './onDemandReports'
export type {
  OnDemandReport,
  OnDemandReportColumn,
  OnDemandReportUser,
  OnDemandReportFilters,
  OnDemandFilterKey,
  OnDemandReportPage,
  OnDemandReportRowsResult,
  OnDemandReportDownloadResult,
  OnDemandReportSummary,
  OnDemandFilterOptions,
} from './onDemandReports'
