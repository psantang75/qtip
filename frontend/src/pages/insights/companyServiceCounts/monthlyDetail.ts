/**
 * Excel-layout reproduction for the Service Counts report page — interactive.
 *
 * Reporting model the business asked for:
 *   - SXM and "Other" are caret-expandable roll-up columns (no parent pill):
 *       SXM   → SXM Internet + SXM Satellite
 *       Other → PN + DMX + Sonos Fees
 *   - Every report leaf is its own selectable button (SXM Internet, SXM
 *     Satellite, SYB, MOH/ISP, PN, DMX). Only selected leaves show; churn,
 *     growth and "All Services" recompute on the selected aggregate.
 *   - Warranty, Unknown and any unselected leaf fold into "Diff" so the report
 *     still ties to the company grand total.
 *   - Year subtotal rows summarize the flow columns and annualize the rates.
 *
 * Formula parity with the workbook (scoped to the selected aggregate):
 *   Change   = Start - Stop
 *   Churn %  = (Stop - React) / Total
 *   Growth % = (Start - Stop) / Total
 *   Rolling 12 = trailing 12-month average of the monthly rate
 *   % of Svc = column Total / selected All-Services Total
 *   Diff     = company grand Total - selected All-Services Total
 *
 * All numbers come from the server `Dataset` (ie_fact_service_counts).
 */
import type { Dataset, Segment } from './serviceCountsModel'

export interface DetailCell { start: number; stop: number; change: number; react: number | null; total: number }
export interface DetailRow {
  kind: 'month' | 'year'
  label: string
  cells: Record<string, DetailCell>
  all: DetailCell
  churnMonth: number
  churnR12: number
  growthMonth: number
  growthR12: number
  pct: Record<string, number>
  difference: number
  /** In-progress month (or a year subtotal that includes it): shown but never a rate basis. */
  partial?: boolean
}

/** A rendered column: a group roll-up (SXM/Other), a group child, or a single leaf. */
export interface ReportLine {
  key: string
  label: string
  short: string
  leaves: string[]
  hasReact: boolean
  /** Which caret group this column belongs to (drives expand/collapse chevrons). */
  groupKey?: 'sxm' | 'other'
  /** True when this is the collapsed roll-up column for its group. */
  isGroupTotal?: boolean
}

/** Selectable leaves, in button/display order. */
export interface LeafMeta { key: string; label: string; short: string; hasReact: boolean; groupKey: 'sxm' | 'syb' | 'moh' | 'other' }
export const REPORT_LEAVES: LeafMeta[] = [
  { key: 'sxm_internet', label: 'SXM Internet', short: 'SXMIR', hasReact: true, groupKey: 'sxm' },
  { key: 'sxm_satellite', label: 'SXM Satellite', short: 'SXMSat', hasReact: true, groupKey: 'sxm' },
  { key: 'syb', label: 'SYB', short: 'SYB', hasReact: true, groupKey: 'syb' },
  { key: 'moh', label: 'MOH / ISP', short: 'MOH', hasReact: false, groupKey: 'moh' },
  { key: 'playnetwork', label: 'PN', short: 'PN', hasReact: false, groupKey: 'other' },
  { key: 'dmx', label: 'DMX', short: 'DMX', hasReact: false, groupKey: 'other' },
  { key: 'sonos', label: 'Sonos Fees', short: 'Sonos', hasReact: false, groupKey: 'other' },
]
const META = new Map(REPORT_LEAVES.map((l) => [l.key, l]))

/** Column groups, in display order. `caret` groups (SXM/Other) can expand. */
const GROUPS: { key: 'sxm' | 'syb' | 'moh' | 'other'; label: string; leaves: string[]; caret: boolean }[] = [
  { key: 'sxm', label: 'SXM', leaves: ['sxm_internet', 'sxm_satellite'], caret: true },
  { key: 'syb', label: 'SYB', leaves: ['syb'], caret: false },
  { key: 'moh', label: 'MOH / ISP', leaves: ['moh'], caret: false },
  { key: 'other', label: 'Other', leaves: ['playnetwork', 'dmx', 'sonos'], caret: true },
]

const OFF_REPORT_LEAVES = ['warranty', 'unknown']
const ALL_LEAVES = [...REPORT_LEAVES.map((l) => l.key), ...OFF_REPORT_LEAVES]

/** All report leaves default ON. */
export const DEFAULT_SELECTED = REPORT_LEAVES.map((l) => l.key)

export interface ExpandState { sxm: boolean; other: boolean }

function makeAggregate(byKey: Map<string, Segment>) {
  return (leaves: string[], i: number): DetailCell => {
    let start = 0, stop = 0, react = 0, total = 0
    for (const k of leaves) {
      const f = byKey.get(k)?.flows[i]
      if (!f) continue
      start += f.started; stop += f.stopped; react += f.react; total += f.eom
    }
    return { start, stop, change: start - stop, react, total }
  }
}

const sumCell = (cells: DetailCell[], yearEndTotal: number): DetailCell => ({
  start: cells.reduce((s, c) => s + c.start, 0),
  stop: cells.reduce((s, c) => s + c.stop, 0),
  react: cells.reduce((s, c) => s + (c.react ?? 0), 0),
  change: cells.reduce((s, c) => s + c.start - c.stop, 0),
  total: yearEndTotal,
})

/** Columns to render for the current selection + expand state, in order. */
export function reportColumns(selected: string[], expand: ExpandState): ReportLine[] {
  const out: ReportLine[] = []
  for (const g of GROUPS) {
    const sel = g.leaves.filter((k) => selected.includes(k))
    if (sel.length === 0) continue
    const expanded = g.caret && (g.key === 'sxm' || g.key === 'other') && expand[g.key] && sel.length > 1
    if (expanded) {
      for (const lk of sel) {
        const m = META.get(lk)!
        out.push({ key: lk, label: m.label, short: m.short, leaves: [lk], hasReact: m.hasReact, groupKey: g.key as 'sxm' | 'other', isGroupTotal: false })
      }
    } else if (g.caret) {
      // Collapsed roll-up. SXM reads "SXM Total" to make clear it's the combined line.
      const label = g.key === 'sxm' ? 'SXM Total' : g.label
      out.push({ key: g.key, label, short: label, leaves: sel, hasReact: sel.some((k) => META.get(k)!.hasReact), groupKey: g.key as 'sxm' | 'other', isGroupTotal: true })
    } else {
      const m = META.get(sel[0])!
      out.push({ key: g.key, label: g.label, short: m.short, leaves: sel, hasReact: m.hasReact })
    }
  }
  return out
}

/** Which caret groups can currently expand (>1 selected child). */
export function expandableGroups(selected: string[]): ExpandState {
  const count = (keys: string[]) => keys.filter((k) => selected.includes(k)).length
  return { sxm: count(['sxm_internet', 'sxm_satellite']) > 1, other: count(['playnetwork', 'dmx', 'sonos']) > 1 }
}

export interface DetailParams {
  selected: string[]
  expand: ExpandState
  /**
   * Cap the displayed months to the most recent N (newest-first), still headed by
   * each year's subtotal (full-year Total / current-year YTD). 0/undefined shows
   * the full history. Rates (incl. the trailing "Rolling 12" columns and the year
   * subtotals) are always computed over full history regardless of the cap.
   */
  maxMonths?: number
}

export function monthlyDetail(ds: Dataset, { selected, expand, maxMonths }: DetailParams): { columns: ReportLine[]; rows: DetailRow[] } {
  const columns = reportColumns(selected, expand)
  const selectedLeaves = REPORT_LEAVES.map((l) => l.key).filter((k) => selected.includes(k))
  const byKey = new Map(ds.segments.map((s) => [s.key, s]))
  const aggregate = makeAggregate(byKey)
  const anchorIndex = ds.currentIndex

  // Per-month values (oldest → newest), sliced to the current-month anchor.
  const base = ds.monthLabels.slice(0, anchorIndex + 1).map((label, i) => {
    const cells: Record<string, DetailCell> = {}
    for (const col of columns) cells[col.key] = aggregate(col.leaves, i)
    const all = aggregate(selectedLeaves, i)
    const grand = aggregate(ALL_LEAVES, i)
    const churnMonth = all.total ? ((all.stop - all.react) / all.total) * 100 : 0
    const growthMonth = all.total ? (all.change / all.total) * 100 : 0
    const pct: Record<string, number> = {}
    for (const col of columns) pct[col.key] = all.total ? (cells[col.key].total / all.total) * 100 : 0
    const isPartial = ds.isPartial && i === anchorIndex
    return { year: ds.monthYears[i], month0: ds.monthNum[i], label, cells, all, churnMonth, growthMonth, pct, difference: grand.total - all.total, isPartial }
  })

  const r2 = (n: number) => +n.toFixed(2)
  const r1 = (n: number) => +n.toFixed(1)

  const monthRow = (r: typeof base[number], i: number): DetailRow => {
    // Rolling-12 averages only over completed months (drop the in-progress month).
    const window = base.slice(Math.max(0, i - 11), i + 1).filter((b) => !b.isPartial)
    const avg = (pick: (b: typeof base[number]) => number) =>
      window.length ? window.reduce((s, b) => s + pick(b), 0) / window.length : 0
    return {
      kind: 'month', label: r.label, cells: r.cells, all: r.all,
      churnMonth: r2(r.churnMonth), churnR12: r2(avg((b) => b.churnMonth)),
      growthMonth: r2(r.growthMonth), growthR12: r2(avg((b) => b.growthMonth)),
      pct: Object.fromEntries(Object.entries(r.pct).map(([k, v]) => [k, r1(v)])),
      difference: r.difference, partial: r.isPartial,
    }
  }

  const anchorYear = ds.monthYears[anchorIndex]
  const yearRow = (year: number): DetailRow => {
    const months = base.filter((b) => b.year === year)
    const end = months[months.length - 1] // year-end (stocks use latest included month)
    // Rate means exclude any in-progress month so a partial month never skews the year.
    const rateMonths = months.filter((b) => !b.isPartial)
    const cells: Record<string, DetailCell> = {}
    for (const col of columns) cells[col.key] = sumCell(months.map((m) => m.cells[col.key]), end.cells[col.key].total)
    const all = sumCell(months.map((m) => m.all), end.all.total)
    const mean = (pick: (b: typeof base[number]) => number) =>
      rateMonths.length ? rateMonths.reduce((s, b) => s + pick(b), 0) / rateMonths.length : 0
    const pct: Record<string, number> = {}
    for (const col of columns) pct[col.key] = end.all.total ? r1((end.cells[col.key].total / end.all.total) * 100) : 0
    // "YTD" only for the anchor's own year when it hasn't closed December.
    const incomplete = year === anchorYear && (end.isPartial || end.month0 < 11)
    return {
      kind: 'year', label: incomplete ? `${year} YTD` : `${year} Total`, cells, all,
      churnMonth: r2(mean((b) => b.churnMonth)), churnR12: 0,
      growthMonth: r2(mean((b) => b.growthMonth)), growthR12: 0,
      pct, difference: end.difference,
    }
  }

  const monthRows = base.map(monthRow)

  // Rolling window caps the displayed months to the most recent N, but still keeps
  // each year's subtotal heading its block — the year Total (and current-year YTD)
  // rows summarize the FULL year regardless of how many of its months are shown.
  // 0/undefined = full history.
  const firstVisible = maxMonths && maxMonths > 0 ? Math.max(0, base.length - maxMonths) : 0

  // Newest-first, with a year subtotal heading each year block.
  const years = [...new Set(base.slice(firstVisible).map((b) => b.year))].sort((a, b) => b - a)
  const rows: DetailRow[] = []
  for (const y of years) {
    rows.push(yearRow(y))
    rows.push(...monthRows.filter((_, i) => base[i].year === y && i >= firstVisible).reverse())
  }
  return { columns, rows }
}
