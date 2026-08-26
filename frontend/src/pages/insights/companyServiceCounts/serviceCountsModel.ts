/**
 * Data model for the Company Reporting → Service Counts report.
 *
 * The numbers come live from ie_fact_service_counts (dissected
 * sp_ReportServiceCountsByMonthByProviderByZoneType) via
 * /insights/company-reporting/service-counts. This module holds:
 *   - the conformed grain types (SegFlow / Segment) + a resolved `Dataset`,
 *   - the static product config (labels/colors/flags per segment_key), and
 *   - the window-relative breakout math (churn, growth, net adds, quick ratio).
 * The monthly-detail table math lives in ./monthlyDetail and consumes the same
 * `Dataset`, so the formulas have a single source of truth.
 *
 * Note: Sonos Platform (provider 12) is excluded by the original procedure but is
 * re-added by our extract as its own `sonos` line (see service_counts.extract.sql),
 * so the other lines still tie out to the workbook while Sonos Fees appears here.
 */
import type { ServiceCountsResponse, ServiceCountFlow } from '@/services/insightsService'

export type SegFlow = ServiceCountFlow

export interface Segment {
  key: string
  label: string
  color: string
  /** True for the in-store-messaging add-on line. */
  addon?: boolean
  /** Whether this line tracks reactivations (mirrors the Excel report's React columns). */
  hasReact?: boolean
  flows: SegFlow[]
}

/**
 * A resolved rate window. `currentIdx` is the prior-day snapshot month (drives
 * the point-in-time Active/EoM/% of Base); flow + rate metrics accumulate over
 * [startIdx, currentIdx], with `baseIdx` (= startIdx − 1) as the rate
 * denominator (the base at the start of the window). See timeModel.ts.
 */
export interface RateWindow {
  currentIdx: number
  startIdx: number
  baseIdx: number
}

/** Everything the report renders off, resolved from the API response. */
export interface Dataset {
  segments: Segment[]
  monthLabels: string[]
  monthYears: number[]
  monthNum: number[]
  monthCount: number
  currentIndex: number
  isPartial: boolean
}

interface SegConfig { label: string; color: string; addon?: boolean; hasReact?: boolean }

// Static product config per segment_key. Brand palette: primary #00aeef,
// success #1abc9c, warning #f39c12, slate #94a3b8; off-report lines stay neutral.
export const SEGMENT_CONFIG: Record<string, SegConfig> = {
  sxm_internet:  { label: 'SXM Internet', color: '#00aeef', hasReact: true },
  sxm_satellite: { label: 'SXM Satellite', color: '#94a3b8', hasReact: true },
  syb:           { label: 'SYB', color: '#1abc9c', hasReact: true },
  moh:           { label: 'In-Store Messaging', color: '#f39c12', addon: true },
  playnetwork:   { label: 'PlayNetwork', color: '#64748b' },
  dmx:           { label: 'DMX', color: '#7c8ba1' },
  sonos:         { label: 'Sonos Fees', color: '#5b6b82' },
  warranty:      { label: 'Warranty', color: '#a3aec0' },
  unknown:       { label: 'Unknown', color: '#cbd5e1' },
}

/** Segments shown in the Product Line Breakout, in display order. */
const BREAKOUT_KEYS = ['sxm_internet', 'sxm_satellite', 'syb', 'moh', 'playnetwork', 'dmx', 'sonos']

const zeroFlows = (n: number): SegFlow[] => Array.from({ length: n }, () => ({ started: 0, stopped: 0, react: 0, eom: 0 }))

/** Build the resolved dataset from the API response (month labels + segment flows). */
export function buildDataset(res: ServiceCountsResponse): Dataset {
  const monthCount = res.months.length
  const monthLabels: string[] = []
  const monthYears: number[] = []
  const monthNum: number[] = []
  for (const ym of res.months) {
    const year = Number(ym.slice(0, 4))
    const month0 = Number(ym.slice(4, 6)) - 1
    const d = new Date(year, month0, 1)
    monthLabels.push(`${d.toLocaleString('en-US', { month: 'short' })} '${String(year).slice(2)}`)
    monthYears.push(year)
    monthNum.push(month0)
  }

  // One Segment per known config key, in a stable order (breakout lines first,
  // then off-report lines). Missing series default to zero-filled flows.
  const orderedKeys = [...BREAKOUT_KEYS, 'warranty', 'unknown'].filter((k) => k in SEGMENT_CONFIG)
  const segments: Segment[] = orderedKeys.map((key) => {
    const cfg = SEGMENT_CONFIG[key]
    return {
      key,
      label: cfg.label,
      color: cfg.color,
      addon: cfg.addon,
      hasReact: cfg.hasReact,
      flows: res.series[key] ?? zeroFlows(monthCount),
    }
  })

  return {
    segments,
    monthLabels,
    monthYears,
    monthNum,
    monthCount,
    currentIndex: res.currentIndex,
    isPartial: res.isPartial,
  }
}

const sumBy = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((s, t) => s + f(t), 0)

// ── Per-line breakout (window-relative) ─────────────────────────────────────────

export interface BreakoutRow {
  key: string
  label: string
  color: string
  addon: boolean
  /** Prior-day snapshot (window-independent). */
  eom: number
  /** Window-relative flow/rate metrics. */
  netAdds: number
  grossChurn: number
  netChurn: number
  growth: number
  quickRatio: number
  /** Prior-day share of base (window-independent). */
  pctOfBase: number
}

export type BreakoutMetrics = Omit<BreakoutRow, 'key' | 'label' | 'color' | 'addon'>

/** Sum a flow field across the window's accumulation span [startIdx, currentIdx]. */
function windowSum(seg: Segment, pick: (f: SegFlow) => number, w: RateWindow): number {
  return sumBy(seg.flows.slice(w.startIdx, w.currentIdx + 1), pick)
}

const bySeg = (ds: Dataset) => new Map(ds.segments.map((s) => [s.key, s]))

/** Breakout lines (Warranty/Unknown excluded — they only exist in the detail Diff). */
function breakoutSegments(ds: Dataset): Segment[] {
  const m = bySeg(ds)
  return BREAKOUT_KEYS.map((k) => m.get(k)).filter((s): s is Segment => !!s)
}

/**
 * Window-relative metrics for a set of segments. EoM + % of Base are prior-day
 * snapshots; Net Adds / Growth / Churn / Quick Ratio accumulate over the window
 * with the base recomputed on the summed start-of-window base (never averaged).
 *
 * Reactivations are a NOTATION inside Started (a returning subscriber gets a new
 * start), not a separate inflow — so they are never added on top of Started
 * (that would double-count). They only appear as a win-back offset in Net Churn,
 * mirroring the workbook's `Churn % = (Stop − React) / Total`.
 */
function aggregateMetrics(segs: Segment[], baseTotal: number, w: RateWindow): BreakoutMetrics {
  const eom = sumBy(segs, (s) => s.flows[w.currentIdx]?.eom ?? 0)
  const eomStart = sumBy(segs, (s) => s.flows[w.baseIdx]?.eom ?? 0) || 1
  const stopped = sumBy(segs, (s) => windowSum(s, (f) => f.stopped, w))
  const started = sumBy(segs, (s) => windowSum(s, (f) => f.started, w))
  const react = sumBy(segs, (s) => windowSum(s, (f) => f.react, w))
  return {
    eom,
    netAdds: started - stopped,
    grossChurn: +((stopped / eomStart) * 100).toFixed(1),
    netChurn: +(((stopped - react) / eomStart) * 100).toFixed(1),
    growth: +(((eom - eomStart) / eomStart) * 100).toFixed(1),
    quickRatio: stopped ? +(started / stopped).toFixed(2) : 0,
    pctOfBase: +((eom / baseTotal) * 100).toFixed(1),
  }
}

const breakoutBaseTotal = (ds: Dataset, w: RateWindow) =>
  sumBy(breakoutSegments(ds), (s) => s.flows[w.currentIdx]?.eom ?? 0) || 1

/** SXM subtotal (Internet + Satellite) for the breakout. */
export function segmentBreakoutSxmTotal(ds: Dataset, w: RateWindow): BreakoutMetrics {
  const m = bySeg(ds)
  const sxm = ['sxm_internet', 'sxm_satellite'].map((k) => m.get(k)).filter((s): s is Segment => !!s)
  return aggregateMetrics(sxm, breakoutBaseTotal(ds, w), w)
}

/** Aggregate "All Lines" total for the breakout — rates recomputed on the summed base. */
export function segmentBreakoutTotal(ds: Dataset, w: RateWindow): BreakoutMetrics {
  return { ...aggregateMetrics(breakoutSegments(ds), breakoutBaseTotal(ds, w), w), pctOfBase: 100 }
}

export function segmentBreakout(ds: Dataset, w: RateWindow): BreakoutRow[] {
  const baseTotal = breakoutBaseTotal(ds, w)
  return breakoutSegments(ds).map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    addon: !!s.addon,
    ...aggregateMetrics([s], baseTotal, w),
  }))
}
