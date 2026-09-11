/**
 * Response shapes for Insights → Agent Activity - CSR → Call Length.
 * Mirrors backend/src/services/insightsCallLength.service.ts.
 *
 * "Length" is total handle time (talk + hold + wrap). The bucket definition
 * arrives from the server in `bands` rather than being restated here, so the
 * boundaries have exactly one home.
 */

export interface CallLengthBand {
  key: string
  label: string
  minSecs: number
  /** null on the open-ended top bucket. */
  maxSecs: number | null
}

/** One bucket, across the whole filtered population. */
export interface BandTotal {
  key: string
  label: string
  calls: number
  pctCalls: number
  handleHours: number
  /** After-call work inside this bucket, charted against handleHours. */
  wrapHours: number
  /** Share of total handle time. Diverges sharply from pctCalls — that's the point. */
  pctTime: number
  avgMin: number
}

export interface DeptBandRow {
  department: string
  calls: number
  avgHandleMin: number
  /** Bucket key -> call count. */
  bands: Record<string, number>
}

export interface RepBandRow {
  agent: string
  department: string
  calls: number
  avgTalkMin: number
  avgWrapMin: number
  avgHandleMin: number
  bands: Record<string, number>
}

export interface CallLengthResponse {
  bands: CallLengthBand[]
  /** Departments present, highest volume first — the chart series order. */
  departments: string[]
  kpis: Record<string, number>
  bandTotals: BandTotal[]
  byDept: DeptBandRow[]
  byRep: RepBandRow[]
  /**
   * Share of calls whose Genesys wrap-up code timed out instead of being set.
   * High values mean a chunk of handle time is the wrap-up screen sitting open,
   * not customer contact.
   */
  wrapTimeoutPct: number
  availableUsers: string[]
  availableDepartments: string[]
  dataLastUpdated: string | null
  dataNextUpdate: string | null
  updateEveryMinutes: number | null
}
