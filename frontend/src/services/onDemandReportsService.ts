import { api } from './authService'

// ── Types ───────────────────────────────────────────────────────────────────

export interface OnDemandReportColumn {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  /** Optional value-formatting hint the UI uses when rendering cells. */
  format?: 'percent' | 'number' | 'date' | 'text'
}

export type OnDemandFilterKey =
  | 'period' | 'departments' | 'forms' | 'agents' | 'submissionId'
  | 'topics' | 'status' | 'sessionId'

/** Per-report default values for filter controls (e.g. coaching → status=CLOSED). */
export interface OnDemandReportDefaults {
  departments?: string[]
  forms?: string[]
  agents?: string[]
  submissionId?: string
  topics?: string[]
  status?: string
  sessionId?: string
}

export interface OnDemandReportSummary {
  id: string
  name: string
  description: string
  columns: OnDemandReportColumn[]
  /** Filter controls the UI should render for this report. */
  supportedFilters: OnDemandFilterKey[]
  /** Optional defaults the UI should pre-populate the filter form with. */
  defaultFilters?: OnDemandReportDefaults
}

/**
 * Filter shape the UI sends when running, downloading, or asking for filter
 * options. Period names mirror the InsightsFilterBar values (`current_month`,
 * `prior_week`, …). `custom` requires `customStart`+`customEnd`.
 */
export interface OnDemandReportFilterParams {
  period: string
  customStart?: string
  customEnd?: string
  departments?: string[]
  forms?: string[]
  agents?: string[]
  submissionId?: string
  topics?: string[]
  status?: string
  sessionId?: string
}

export interface OnDemandReportRunParams extends OnDemandReportFilterParams {
  page?: number
  pageSize?: number
}

export interface OnDemandReportRunResult {
  columns: OnDemandReportColumn[]
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  appliedRange: { start_date: string; end_date: string }
}

export interface OnDemandFilterOptions {
  departments: string[]
  forms: string[]
  agents: string[]
  topics: string[]
  statuses: string[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildFilterPayload(params: OnDemandReportFilterParams): Record<string, unknown> {
  const out: Record<string, unknown> = { period: params.period }
  if (params.period === 'custom') {
    out.customStart = params.customStart
    out.customEnd = params.customEnd
  }
  if (params.departments?.length) out.departments = params.departments
  if (params.forms?.length) out.forms = params.forms
  if (params.agents?.length) out.agents = params.agents
  if (params.submissionId) out.submissionId = params.submissionId
  if (params.topics?.length) out.topics = params.topics
  if (params.status) out.status = params.status
  if (params.sessionId) out.sessionId = params.sessionId
  return out
}

// Reports can scan a lot of data; bypass the global 10s axios timeout.
const REPORT_RUN_TIMEOUT_MS = 5 * 60 * 1000   // 5 min for in-browser run
const REPORT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000 // 10 min for xlsx download

// ── API ─────────────────────────────────────────────────────────────────────

/** List the on-demand reports the current user can run. */
export async function listReports(): Promise<OnDemandReportSummary[]> {
  const { data } = await api.get('/on-demand-reports')
  return (data?.data ?? []) as OnDemandReportSummary[]
}

/** Get metadata for a single report. */
export async function getReport(id: string): Promise<OnDemandReportSummary> {
  const { data } = await api.get(`/on-demand-reports/${encodeURIComponent(id)}`)
  return data?.data as OnDemandReportSummary
}

/** Run a report and return paginated rows for in-browser viewing. */
export async function runReport(
  id: string,
  params: OnDemandReportRunParams,
): Promise<OnDemandReportRunResult> {
  const payload = {
    ...buildFilterPayload(params),
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 50,
  }
  const { data } = await api.post(
    `/on-demand-reports/${encodeURIComponent(id)}/data`,
    payload,
    { timeout: REPORT_RUN_TIMEOUT_MS },
  )
  return data?.data as OnDemandReportRunResult
}

/**
 * Run the report and trigger a browser download of the resulting xlsx file.
 * Reads `Content-Disposition` for the server-supplied filename, falling back
 * to a sane default if missing.
 */
export async function downloadReport(
  id: string,
  params: OnDemandReportFilterParams,
  fallbackName: string = 'OnDemandReport.xlsx',
): Promise<void> {
  const response = await api.post(
    `/on-demand-reports/${encodeURIComponent(id)}/download`,
    buildFilterPayload(params),
    { responseType: 'blob', timeout: REPORT_DOWNLOAD_TIMEOUT_MS },
  )

  const disposition = (response.headers?.['content-disposition'] || '') as string
  const filename = parseDispositionFilename(disposition) || fallbackName

  const blob = response.data as Blob
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

/**
 * Fetch the cross-filtered department / form / agent lists available inside
 * the requested period. Used to populate the filter dropdowns on the report
 * view page.
 */
export async function getFilterOptions(
  id: string,
  params: OnDemandReportFilterParams,
): Promise<OnDemandFilterOptions> {
  const { data } = await api.post(
    `/on-demand-reports/${encodeURIComponent(id)}/filter-options`,
    buildFilterPayload(params),
  )
  const opts = (data?.data ?? {}) as Partial<OnDemandFilterOptions>
  return {
    departments: opts.departments ?? [],
    forms: opts.forms ?? [],
    agents: opts.agents ?? [],
    topics: opts.topics ?? [],
    statuses: opts.statuses ?? [],
  }
}

function parseDispositionFilename(disposition: string): string | null {
  if (!disposition) return null
  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]) } catch { /* fallthrough */ }
  }
  const plainMatch = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)
  if (plainMatch) return plainMatch[1]
  return null
}
