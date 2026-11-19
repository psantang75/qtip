/**
 * Response shapes for Insights → Agent Activity - CSR → Call Length.
 * Mirrors backend/src/services/insightsCallLength.service.ts.
 *
 * "Length" is total handle time (talk + hold + wrap + wrap extended + wrap
 * pending). The bucket definition arrives from the server in `bands` rather
 * than being restated here, so the boundaries have exactly one home.
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
  /** The three after-call parts inside this bucket, charted against handleHours. */
  wrapHours: number
  wrapExtendedHours: number
  wrapPendingHours: number
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
   * Share of calls whose Genesys wrap-up code timed out instead of being set
   * (the old 90s wrap running out; none after the Nov 2026 redesign).
   */
  wrapTimeoutPct: number
  availableUsers: string[]
  availableDepartments: string[]
  dataLastUpdated: string | null
  dataNextUpdate: string | null
  updateEveryMinutes: number | null
}
