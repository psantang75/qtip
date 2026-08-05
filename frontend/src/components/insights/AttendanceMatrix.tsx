/**
 * AttendanceMatrix — person-by-month schedule compliance. The only net-new shape
 * in the Insights component set: nothing else renders rows-as-people against
 * columns-as-months.
 *
 * Cell colour comes from the same ie_kpi_threshold machinery every other Insights
 * number uses (resolveThresholds + getThresholdStatus), so the bands are editable
 * in Admin -> Insights -> KPIs rather than hardcoded here. Tints are the light
 * emerald/orange/red used by StatusBadge, not the solid THRESHOLD_BG swatches,
 * which are for dots and bars and would drown a table cell.
 *
 * Colour is never the only signal: every cell shows its percentage, and a blank
 * cell means no scheduled time rather than zero percent.
 */
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { getThresholdStatus } from '@/constants/kpiDefs'
import type { KpiDef } from '@/constants/kpiDefs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ComplianceMatrixResponse, ComplianceCell } from '@/services/insightsCsrService'

const STATUS_CELL: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-orange-50 text-orange-600',
  critical: 'bg-red-50 text-red-600',
  neutral: 'text-slate-600',
}

/** 'Jul 2026' from '2026-07'. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

interface AttendanceMatrixProps {
  data: ComplianceMatrixResponse
  thresholds: Pick<KpiDef, 'direction' | 'goal' | 'warn' | 'crit'>
}

export default function AttendanceMatrix({ data, thresholds }: AttendanceMatrixProps) {
  const cell = (c: ComplianceCell, bold = false) => {
    if (c.pct === null) {
      return <td key={c.month} className="py-2.5 px-2 text-right text-slate-300">&mdash;</td>
    }
    const status = getThresholdStatus(c.pct, thresholds)
    return (
      <td
        key={c.month}
        className={cn('py-2.5 px-2 text-right tabular-nums', STATUS_CELL[status], bold && 'font-semibold')}
        title={`${Math.round(c.adherentMinutes / 60)}h worked of ${Math.round(c.scheduledMinutes / 60)}h scheduled`}
      >
        {c.pct.toFixed(1)}%
      </td>
    )
  }

  if (data.rows.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No scheduled time in this range.</p>
  }

  let lastDept = ''

  return (
    <>
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead>
          <tr className="text-xs text-slate-400 border-b border-slate-200">
            <th className="text-left pb-2 pl-4 font-medium">Agent</th>
            {data.months.map(m => (
              <th key={m} className="text-right pb-2 px-2 font-medium whitespace-nowrap">{monthLabel(m)}</th>
            ))}
            <th className="text-right pb-2 pr-4 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => {
            const showDept = r.dept !== lastDept
            lastDept = r.dept
            return (
              <Fragment key={r.userId}>
                {showDept && (
                  <tr className="bg-surface">
                    <td
                      className="py-1.5 pl-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                      colSpan={data.months.length + 2}
                    >
                      {r.dept}
                    </td>
                  </tr>
                )}
                <tr className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 pl-4 text-slate-600 whitespace-nowrap">{r.name}</td>
                  {r.cells.map(c => cell(c))}
                  {cell(
                    { month: 'total', scheduledMinutes: r.totalScheduled, adherentMinutes: r.totalAdherent, pct: r.totalPct },
                    true,
                  )}
                </tr>
              </Fragment>
            )
          })}
          <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
            <td className="py-2.5 pl-4">Grand Total</td>
            {data.columnTotals.map(c => cell(c, true))}
            {cell(
              {
                month: 'grand',
                scheduledMinutes: data.columnTotals.reduce((s, c) => s + c.scheduledMinutes, 0),
                adherentMinutes: data.columnTotals.reduce((s, c) => s + c.adherentMinutes, 0),
                pct: data.grandTotalPct,
              },
              true,
            )}
          </tr>
        </tbody>
      </table>
    </div>
    <AdherenceLegend thresholds={thresholds} />
    </>
  )
}

/**
 * Colour-band key for the matrix. The chip itself is the hover trigger (per the UI
 * rules — no info-icon buttons), and the ranges are read from the live thresholds
 * so they always match the cell colouring and the KPI registry.
 */
function AdherenceLegend({ thresholds }: { thresholds: AttendanceMatrixProps['thresholds'] }) {
  const { goal, crit } = thresholds
  if (goal == null || crit == null) return null

  const bands = [
    {
      status: 'good',
      range: `\u2265 ${goal}%`,
      label: 'On standard',
      tip: 'Full scheduled hours delivered. Timing that was made up the same day still lands here.',
    },
    {
      status: 'warning',
      range: `${crit}\u2013${goal}%`,
      label: 'Watch',
      tip: 'A small amount of unworked time — a long lunch or a break beyond the allowance — that was not made up.',
    },
    {
      status: 'critical',
      range: `< ${crit}%`,
      label: 'Below standard',
      tip: 'Meaningful unworked time across the window.',
    },
  ]

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] text-slate-400">Adherence scale:</span>
        {bands.map((b) => (
          <Tooltip key={b.status}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] tabular-nums cursor-help',
                  STATUS_CELL[b.status],
                )}
              >
                <span className="font-semibold">{b.range}</span>
                <span className="opacity-80">{b.label}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-[11px] leading-relaxed">
              {b.tip}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
