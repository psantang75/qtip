/**
 * Time model for the Service Counts report.
 *
 * This page does NOT use the shared period filter. Instead:
 *   - The Service Counts By Month table is ALWAYS current — prior-day totals,
 *     with the in-progress month shown to date. Nothing changes it.
 *   - The Product Line Breakout has its own window buttons (MTD / QTD / YTD /
 *     Rolling 12, default YTD). "Active (EoM)" and "% of Base" stay prior-day
 *     current; the flow/rate columns recompute over the chosen window.
 *
 * The month series + current-month anchor come from the server (Dataset); all
 * indexing is relative to that array. Date math is local-first per
 * .cursor/rules/date-handling.mdc.
 */
import type { Dataset, RateWindow } from './serviceCountsModel'

export type BreakoutWindowKey = 'mtd' | 'qtd' | 'ytd' | 'r12'
export const BREAKOUT_WINDOWS: { key: BreakoutWindowKey; label: string; short: string }[] = [
  { key: 'mtd', label: 'Month to Date', short: 'MTD' },
  { key: 'qtd', label: 'Quarter to Date', short: 'QTD' },
  { key: 'ytd', label: 'Year to Date', short: 'YTD' },
  { key: 'r12', label: 'Rolling 12', short: 'R12' },
]
export const DEFAULT_WINDOW: BreakoutWindowKey = 'ytd'

const clampIdx = (ds: Dataset, i: number) => Math.max(0, Math.min(ds.monthCount - 1, i))

/** First month included in the window's flows (window END is always currentIndex). */
function windowStartIndex(ds: Dataset, key: BreakoutWindowKey): number {
  const cur = ds.currentIndex
  const m0 = ds.monthNum[cur] ?? 0
  switch (key) {
    case 'mtd': return cur
    case 'qtd': return clampIdx(ds, cur - (m0 % 3)) // back to the quarter's first month
    case 'ytd': return clampIdx(ds, cur - m0)       // back to January
    case 'r12': return clampIdx(ds, cur - 11)
  }
}

/** Window for the breakout table's flow/rate columns (through the prior-day month). */
export function breakoutRateWindow(ds: Dataset, key: BreakoutWindowKey): RateWindow {
  const startIdx = windowStartIndex(ds, key)
  return { currentIdx: ds.currentIndex, startIdx, baseIdx: Math.max(0, startIdx - 1) }
}

export const monthLabel = (ds: Dataset, i: number) => ds.monthLabels[i] ?? ''

/** "Jan '26 – Aug '26" (or a single month for MTD). */
export function windowRangeLabel(ds: Dataset, w: RateWindow): string {
  return w.startIdx === w.currentIdx
    ? ds.monthLabels[w.currentIdx] ?? ''
    : `${ds.monthLabels[w.startIdx] ?? ''} – ${ds.monthLabels[w.currentIdx] ?? ''}`
}
