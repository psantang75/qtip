/**
 * Type definitions for the On-Demand Reports subsystem.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * These interfaces define the contract every on-demand report must
 * satisfy and the shape of the data flowing between the controller,
 * the registry, and the per-report modules. Centralising them here
 * keeps the per-report implementations short and prevents type
 * drift between modules.
 */

export interface OnDemandReportColumn {
  key: string
  label: string
  /** Optional column-level alignment hint for the UI. */
  align?: 'left' | 'right' | 'center'
  /**
   * Optional value-formatting hint the UI uses when rendering cells.
   * - `percent`  → number formatted as "86.74%"
   * - `number`   → numeric, 2-decimals when non-integer
   * - `date`     → ISO date string
   * - `text`     → plain string (default)
   */
  format?: 'percent' | 'number' | 'date' | 'text'
}

export interface OnDemandReportUser {
  user_id: number
  role: string
  role_id: number
}

/**
 * Filter shape passed into the report functions. The controller has
 * already resolved `period` + `customStart/End` to concrete
 * `start_date / end_date` by this point. Reports only honor the
 * filters they declare in `supportedFilters`; everything else is
 * ignored.
 */
export interface OnDemandReportFilters {
  start_date: string
  end_date: string
  departments?: string[]
  forms?: string[]
  agents?: string[]
  submissionId?: string
  /** Training topic labels (resolved to list_items.id by the report). */
  topics?: string[]
  /** Coaching session status enum value (e.g. 'CLOSED'). */
  status?: string
  /** Numeric coaching_sessions.id (session number). */
  sessionId?: string
}

export type OnDemandFilterKey =
  | 'period' | 'departments' | 'forms' | 'agents' | 'submissionId'
  | 'topics' | 'status' | 'sessionId'

export interface OnDemandReportPage {
  page: number
  pageSize: number
}

export interface OnDemandReportRowsResult {
  rows: Record<string, unknown>[]
  total: number
}

export interface OnDemandReportXlsxResult {
  buffer: Buffer
  filename: string
}

export interface OnDemandReport {
  id: string
  name: string
  description: string
  /** Numeric role ids permitted to run this report (matches users.role_id). */
  roles: number[]
  /** Display columns for the in-browser table. */
  columns: OnDemandReportColumn[]
  /**
   * Filter keys the UI should expose for this report. `period` is
   * implied for every report (date range is required), but listing
   * it keeps the contract explicit for the front-end.
   */
  supportedFilters: OnDemandFilterKey[]
  /**
   * Optional default values the UI should pre-populate the filter
   * form with (e.g. coaching defaults to status=CLOSED). Honored on
   * initial load and on Reset Filters.
   */
  defaultFilters?: Partial<Pick<OnDemandReportFilters,
    'departments' | 'forms' | 'agents' | 'submissionId'
    | 'topics' | 'status' | 'sessionId'>>
  getRows: (
    filters: OnDemandReportFilters,
    user: OnDemandReportUser,
    page: OnDemandReportPage,
  ) => Promise<OnDemandReportRowsResult>
  getXlsx: (
    filters: OnDemandReportFilters,
    user: OnDemandReportUser,
  ) => Promise<OnDemandReportXlsxResult>
}

export interface OnDemandFilterOptions {
  departments: string[]
  forms: string[]
  agents: string[]
  /** Coaching-only: training topic labels available in the date range. */
  topics?: string[]
  /** Coaching-only: status enum values (always full enum, ordered). */
  statuses?: string[]
}
