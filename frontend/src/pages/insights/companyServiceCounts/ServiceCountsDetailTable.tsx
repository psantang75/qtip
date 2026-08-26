import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Percent, Sigma } from 'lucide-react'
import { cn } from '@/lib/utils'
import { optionCls } from '@/utils/forms/optionCls'
import type { Dataset } from './serviceCountsModel'
import {
  monthlyDetail, expandableGroups,
  REPORT_LEAVES, DEFAULT_SELECTED,
  type DetailCell, type DetailRow, type ReportLine, type ExpandState, type LeafMeta,
} from './monthlyDetail'

const nf = (n: number) => n.toLocaleString('en-US')
const pf = (n: number) => `${n.toFixed(1)}%`

/** How many months the detail table shows. "All" (0) is the full history. Year subtotals show either way. */
const MONTH_WINDOWS: { key: string; label: string; months: number }[] = [
  { key: '12', label: 'Rolling 12', months: 12 },
  { key: '24', label: '24 mo', months: 24 },
  { key: '36', label: '36 mo', months: 36 },
  { key: 'all', label: 'All', months: 0 },
]

/** Sticky Month column — a stronger border + shadow so it reads as separate when scrolling. */
const STICKY = 'sticky left-0 z-10 border-r-2 border-slate-300 shadow-[2px_0_4px_-1px_rgba(15,23,42,0.12)]'

function subCount(col: ReportLine) { return col.hasReact ? 5 : 4 }

/**
 * Uniform width + comfortable padding for every numeric cell (headers and body)
 * so columns line up across service blocks regardless of digit count. The table
 * itself is w-full (below), so these are floors — cells share the slack when the
 * report is narrower than the section, and only scroll when it truly can't fit.
 */
const NUM = 'px-2 py-1 text-right tabular-nums min-w-[3rem]'

/** Columns rendered inside one provider block. `muted` greys everything (year rows). */
function BlockCells({ c, hasReact, muted }: { c: DetailCell; hasReact: boolean; muted?: boolean }) {
  return (
    <>
      <td className={cn(NUM, muted ? 'text-slate-400' : 'text-slate-600')}>{nf(c.start)}</td>
      <td className={cn(NUM, muted ? 'text-slate-400' : 'text-slate-600')}>{nf(c.stop)}</td>
      <td className={cn(NUM, muted ? 'text-slate-400' : c.change >= 0 ? 'text-success' : 'text-danger')}>
        {c.change >= 0 ? '+' : ''}{nf(c.change)}
      </td>
      {hasReact && <td className={cn(NUM, 'text-slate-400')}>{c.react == null ? '—' : nf(c.react)}</td>}
      <td className={cn(NUM, 'font-semibold border-r border-slate-200', muted ? 'text-slate-400' : 'text-slate-800')}>{nf(c.total)}</td>
    </>
  )
}

/** Service-leaf filter chip — DM Ops Hub recon style: outline when off, solid primary + check when on. */
function ServicePill({ leaf, active, onClick }: { leaf: LeafMeta; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
        active ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
      {active && <Check className="h-3.5 w-3.5" />}
      {leaf.label}
    </button>
  )
}

/** Show/hide toggle for an optional column group (Diff, % of Services). */
function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium',
        active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
      {icon}
      {label}
    </button>
  )
}

/**
 * Interactive reproduction of the Excel "Report - Service Counts" sheet.
 *
 * SXM and Other are caret-expandable roll-ups; every leaf is a selectable
 * button (churn/growth + All Services recompute on the selection); Warranty,
 * Unknown and any unselected leaf fold into Diff; % of Services and year
 * subtotals can be toggled. Read-only presentation matrix (a spreadsheet, not
 * an interactive grid), so it stays a plain table like the breakout above it.
 */
export function ServiceCountsDetailTable({ ds }: { ds: Dataset }) {
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED)
  const [expand, setExpand] = useState<ExpandState>({ sxm: false, other: false })
  const [showPct, setShowPct] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [monthsKey, setMonthsKey] = useState('12')

  const maxMonths = MONTH_WINDOWS.find((w) => w.key === monthsKey)!.months
  const { columns, rows } = useMemo(
    () => monthlyDetail(ds, { selected, expand, maxMonths }),
    [ds, selected, expand, maxMonths],
  )
  const expandable = useMemo(() => expandableGroups(selected), [selected])

  const toggleLeaf = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  const setGroup = (g: 'sxm' | 'other', v: boolean) => setExpand((cur) => ({ ...cur, [g]: v }))

  // Decide the caret (expand on the roll-up, collapse on the group's first child).
  const seenCollapse = new Set<string>()
  const carets = columns.map((col): 'expand' | 'collapse' | null => {
    if (col.isGroupTotal && col.groupKey && expandable[col.groupKey]) return 'expand'
    if (col.groupKey && !col.isGroupTotal && !seenCollapse.has(col.groupKey)) { seenCollapse.add(col.groupKey); return 'collapse' }
    return null
  })

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 mr-0.5">Services</span>
          {REPORT_LEAVES.map((leaf) => (
            <ServicePill key={leaf.key} leaf={leaf} active={selected.includes(leaf.key)} onClick={() => toggleLeaf(leaf.key)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 mr-0.5">Show</span>
          {MONTH_WINDOWS.map((w) => (
            <button key={w.key} type="button" onClick={() => setMonthsKey(w.key)}
              className={cn('rounded-full border px-3 py-1 text-[12px] font-medium transition-colors', optionCls(monthsKey === w.key))}>
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <ToggleBtn active={showDiff} onClick={() => setShowDiff((v) => !v)} icon={<Sigma className="h-3.5 w-3.5" />} label="Diff" />
          <ToggleBtn active={showPct} onClick={() => setShowPct((v) => !v)} icon={<Percent className="h-3.5 w-3.5" />} label="% of Services" />
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">
          Select at least one service type to see the report.
        </div>
      ) : (
        <div className="w-full overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-[11px] border-collapse whitespace-nowrap">
            <thead>
              {/* Group header */}
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={cn(STICKY, 'bg-slate-50 px-3 py-1.5 text-left font-semibold text-slate-700')}>Month</th>
                {columns.map((col, ci) => (
                  <th key={col.key} colSpan={subCount(col)}
                    className="px-2 py-1.5 text-center font-semibold text-slate-700 border-r border-slate-200">
                    <span className="inline-flex items-center gap-1.5">
                      {carets[ci] === 'expand' && (
                        <ChevronRight onClick={() => setGroup(col.groupKey!, true)}
                          className="h-3.5 w-3.5 cursor-pointer text-slate-400 hover:text-slate-700" />
                      )}
                      {carets[ci] === 'collapse' && (
                        <ChevronDown onClick={() => setGroup(col.groupKey!, false)}
                          className="h-3.5 w-3.5 cursor-pointer text-slate-400 hover:text-slate-700" />
                      )}
                      {col.label}
                    </span>
                  </th>
                ))}
                <th colSpan={5} className="px-2 py-1.5 text-center font-semibold text-slate-800 border-r border-slate-200 bg-slate-100">All Services</th>
                <th colSpan={4} className="px-2 py-1.5 text-center font-semibold text-slate-800 border-r border-slate-200">Churn / Growth</th>
                {showDiff && (
                  <th className="px-2 py-1.5 text-center font-semibold text-slate-500 border-r border-slate-200">Diff</th>
                )}
                {showPct && (
                  <th colSpan={columns.length} className="px-2 py-1.5 text-center font-semibold text-slate-800">% of Services</th>
                )}
              </tr>
              {/* Sub header */}
              <tr className="bg-white border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                <th className={cn(STICKY, 'bg-white px-3 py-1')} />
                {columns.map((col) => <SubHead key={col.key} hasReact={col.hasReact} />)}
                <th className={cn(NUM, 'font-medium bg-slate-50')}>Start</th>
                <th className={cn(NUM, 'font-medium bg-slate-50')}>Stop</th>
                <th className={cn(NUM, 'font-medium bg-slate-50')}>Chg</th>
                <th className={cn(NUM, 'font-medium bg-slate-50')}>React</th>
                <th className={cn(NUM, 'font-medium bg-slate-50 border-r border-slate-200')}>Total</th>
                <th className={cn(NUM, 'font-medium align-bottom')}>Churn</th>
                <th className={cn(NUM, 'font-medium align-bottom whitespace-normal leading-tight')}>Rolling<br />12</th>
                <th className={cn(NUM, 'font-medium align-bottom')}>Growth</th>
                <th className={cn(NUM, 'font-medium align-bottom whitespace-normal leading-tight border-r border-slate-200')}>Rolling<br />12</th>
                {showDiff && <th className={cn(NUM, 'font-medium align-bottom border-r border-slate-200')} />}
                {showPct && columns.map((col) => <th key={col.key} className={cn(NUM, 'font-medium align-bottom')}>{col.short}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <DataRow key={r.label} r={r} columns={columns} showPct={showPct} showDiff={showDiff} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * One month or year-subtotal row. Year rows are fully greyed out (muted text,
 * shaded, darker top border) so they read as summaries, not data.
 */
function DataRow({ r, columns, showPct, showDiff }: { r: DetailRow; columns: ReportLine[]; showPct: boolean; showDiff: boolean }) {
  const isYear = r.kind === 'year'
  // Greyed-out year rows: force muted text on numeric cells (no success/danger).
  const chg = (positive: boolean) => (isYear ? 'text-slate-400' : positive ? 'text-success' : 'text-danger')
  const allBg = isYear ? '' : 'bg-slate-50/60'
  return (
    <tr className={cn('border-b last:border-0',
      isYear ? 'border-t-2 border-slate-300 border-b-slate-200 bg-slate-100 font-semibold text-slate-400'
        : 'border-slate-100 hover:bg-slate-50')}>
      <td className={cn(STICKY, isYear ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700', 'px-3 py-1 font-medium')}>{r.label}</td>
      {columns.map((col) => <BlockCells key={col.key} c={r.cells[col.key]} hasReact={col.hasReact} muted={isYear} />)}
      {/* All Services (selected total) */}
      <td className={cn(NUM, isYear ? 'text-slate-400' : 'text-slate-600', allBg)}>{nf(r.all.start)}</td>
      <td className={cn(NUM, isYear ? 'text-slate-400' : 'text-slate-600', allBg)}>{nf(r.all.stop)}</td>
      <td className={cn(NUM, chg(r.all.change >= 0), allBg)}>
        {r.all.change >= 0 ? '+' : ''}{nf(r.all.change)}
      </td>
      <td className={cn(NUM, 'text-slate-400', allBg)}>{nf(r.all.react ?? 0)}</td>
      <td className={cn(NUM, 'font-bold border-r border-slate-200', isYear ? 'text-slate-400' : 'text-slate-900', allBg)}>{nf(r.all.total)}</td>
      {/* Churn / growth on the selected aggregate */}
      <td className={cn(NUM, isYear ? 'text-slate-400' : 'text-danger')}>{pf(r.churnMonth)}</td>
      <td className={cn(NUM, 'text-slate-400')}>{isYear ? '—' : pf(r.churnR12)}</td>
      <td className={cn(NUM, chg(r.growthMonth >= 0))}>{pf(r.growthMonth)}</td>
      <td className={cn(NUM, 'text-slate-400 border-r border-slate-200')}>{isYear ? '—' : pf(r.growthR12)}</td>
      {/* Off-report reconciliation (warranty, unknown + any unselected leaf) */}
      {showDiff && (
        <td className={cn(NUM, 'text-slate-400 border-r border-slate-200')}>{nf(r.difference)}</td>
      )}
      {/* % of Services (far right) */}
      {showPct && columns.map((col) => (
        <td key={col.key} className={cn(NUM, 'text-slate-500')}>{pf(r.pct[col.key] ?? 0)}</td>
      ))}
    </tr>
  )
}

function SubHead({ hasReact }: { hasReact: boolean }) {
  return (
    <>
      <th className={cn(NUM, 'font-medium')}>Start</th>
      <th className={cn(NUM, 'font-medium')}>Stop</th>
      <th className={cn(NUM, 'font-medium')}>Chg</th>
      {hasReact && <th className={cn(NUM, 'font-medium')}>React</th>}
      <th className={cn(NUM, 'font-medium border-r border-slate-200')}>Total</th>
    </>
  )
}
