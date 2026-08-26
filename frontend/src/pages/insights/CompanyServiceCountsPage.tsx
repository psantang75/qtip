import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, ChevronRight, ChevronDown } from 'lucide-react'
import { InsightsSection } from '@/components/insights'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { PageSpinner } from '@/components/common/PageSpinner'
import { cn } from '@/lib/utils'
import { optionCls } from '@/utils/forms/optionCls'
import { getServiceCounts } from '@/services/insightsService'
import {
  buildDataset, segmentBreakout, segmentBreakoutTotal, segmentBreakoutSxmTotal,
} from './companyServiceCounts/serviceCountsModel'
import {
  BREAKOUT_WINDOWS, DEFAULT_WINDOW, monthLabel, windowRangeLabel,
  breakoutRateWindow, type BreakoutWindowKey,
} from './companyServiceCounts/timeModel'
import { ServiceCountsDetailTable } from './companyServiceCounts/ServiceCountsDetailTable'

const nfmt = (n: number) => n.toLocaleString('en-US')

interface LineMetrics { eom: number; netAdds: number; growth: number; grossChurn: number; netChurn: number; quickRatio: number; pctOfBase: number }

/**
 * Column-header calculation tooltip. The header label itself is the hover
 * trigger (never an info icon) per docs/design.md §6.6, and the card shows the
 * ACTUAL basis it used (the window range, or the prior-day snapshot month).
 */
function HeaderTip({ label, title, body, basisLabel, basisValue }: { label: string; title: string; body: string; basisLabel: string; basisValue: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-left">
        <div className="text-[13px] font-semibold text-slate-800">{title}</div>
        <div className="mt-1 text-[12.5px] text-slate-600">{body}</div>
        <div className="mt-1.5 text-[10px] uppercase tracking-wide text-slate-400">{basisLabel}</div>
        <div className="text-[11px] text-slate-600">{basisValue}</div>
      </TooltipContent>
    </Tooltip>
  )
}

/** The 6 shared metric columns (EoM → % of Base), used by line rows, the SXM subtotal, and All Lines. */
function MetricCells({ m }: { m: LineMetrics }) {
  return (
    <>
      <td className="py-2.5 pr-4 text-right tabular-nums">{nfmt(m.eom)}</td>
      <td className={cn('py-2.5 pr-4 text-right tabular-nums', m.netAdds >= 0 ? 'text-success' : 'text-danger')}>
        {m.netAdds >= 0 ? '+' : ''}{nfmt(m.netAdds)}
      </td>
      <td className={cn('py-2.5 pr-4 text-right tabular-nums', m.growth >= 0 ? 'text-success' : 'text-danger')}>{m.growth}%</td>
      <td className="py-2.5 pr-4 text-right tabular-nums">{m.grossChurn}%</td>
      <td className="py-2.5 pr-4 text-right tabular-nums">{m.netChurn}%</td>
      <td className={cn('py-2.5 pr-4 text-right tabular-nums', m.quickRatio >= 1 ? 'text-success' : 'text-danger')}>{m.quickRatio}×</td>
      <td className="py-2.5 text-right tabular-nums">{m.pctOfBase}%</td>
    </>
  )
}

/** Single-select window picker for the breakout (MTD / QTD / YTD / Rolling 12) — canonical optionCls pills. */
function WindowPicker({ value, onChange }: { value: BreakoutWindowKey; onChange: (v: BreakoutWindowKey) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-400 mr-0.5">Window</span>
      {BREAKOUT_WINDOWS.map((w) => (
        <button key={w.key} type="button" onClick={() => onChange(w.key)}
          className={cn('rounded-full border px-3 py-1 text-[12px] font-medium transition-colors', optionCls(value === w.key))}>
          {w.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Company Reporting → Service Counts.
 *
 * Admin-only (gated by ie_page_role_access via RequireInsightsAccess + the
 * backend company_service_counts page grant). Succeeds the Excel
 * "ServiceCountsByProvider" workbook / sp_ReportServiceCountsByMonthByProviderByZoneType,
 * served live from ie_fact_service_counts via /insights/company-reporting/service-counts.
 *
 * Time model (see timeModel.ts): the Product Line Breakout is the single
 * scorecard — its window buttons (MTD / QTD / YTD / Rolling 12, default YTD)
 * drive the flow/rate columns while Active + % of Base stay prior-day current.
 * The Service Counts By Month table below is always current (prior-day totals).
 */
export default function CompanyServiceCountsPage() {
  const [win, setWin] = useState<BreakoutWindowKey>(DEFAULT_WINDOW)
  const [expandSxm, setExpandSxm] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['insights', 'company-reporting', 'service-counts'],
    queryFn: getServiceCounts,
    staleTime: 5 * 60 * 1000,
  })

  const ds = useMemo(() => (data ? buildDataset(data) : null), [data])

  const bWindow = useMemo(() => (ds ? breakoutRateWindow(ds, win) : null), [ds, win])
  const breakout = useMemo(() => (ds && bWindow ? segmentBreakout(ds, bWindow) : []), [ds, bWindow])
  const total = useMemo(() => (ds && bWindow ? segmentBreakoutTotal(ds, bWindow) : null), [ds, bWindow])
  const sxmTotal = useMemo(() => (ds && bWindow ? segmentBreakoutSxmTotal(ds, bWindow) : null), [ds, bWindow])

  const winShort = BREAKOUT_WINDOWS.find((w) => w.key === win)!.short

  const header = (
    <div className="flex items-start gap-3">
      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Radio className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Service Counts</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Subscription base, churn, growth and mix by provider line.
        </p>
      </div>
    </div>
  )

  if (isLoading) {
    return <div className="space-y-5">{header}<PageSpinner /></div>
  }

  if (isError || !ds || !bWindow || !total || !sxmTotal || ds.currentIndex < 0) {
    return (
      <div className="space-y-5">
        {header}
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
          {isError ? 'Unable to load service counts.' : 'No service-counts data has been loaded yet.'}
        </div>
      </div>
    )
  }

  const winRange = windowRangeLabel(ds, bWindow)
  const priorDay = `prior day (${monthLabel(ds, ds.currentIndex)})`
  const freshness = {
    lastUpdated: data?.dataLastUpdated ?? undefined,
    nextUpdate: data?.dataNextUpdate ?? undefined,
    updateEveryMinutes: data?.updateEveryMinutes ?? undefined,
  }

  // SXM Internet/Satellite are children of the SXM Total roll-up row (shown only when expanded).
  const sxmChildKeys = ['sxm_internet', 'sxm_satellite']
  const rows = breakout.filter((r) => !sxmChildKeys.includes(r.key))
  const sxmChildren = breakout.filter((r) => sxmChildKeys.includes(r.key))

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-5">
      {header}

      {/* Product Line Breakout — the scorecard. Window buttons drive the flow/rate columns. */}
      <InsightsSection title="Product Line Breakout"
        lastUpdated={freshness.lastUpdated} nextUpdate={freshness.nextUpdate} updateEveryMinutes={freshness.updateEveryMinutes}>
        <div className="mb-3">
          <WindowPicker value={win} onChange={setWin} />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-200">
              <th className="text-left pb-2 font-medium pr-4">Line</th>
              <th className="text-right pb-2 font-medium pr-4">
                <HeaderTip label="Active (EoM)" title="Active Base (EoM)"
                  body="Active subscriptions at the end of the month — a point-in-time snapshot, independent of the window."
                  basisLabel="As of" basisValue={priorDay} />
              </th>
              <th className="text-right pb-2 font-medium pr-4">
                <HeaderTip label={`Net Adds (${winShort})`} title="Net Adds"
                  body="Started − Stopped, accumulated over the window. Reactivations are already counted within Started, so they are not added again."
                  basisLabel="Window" basisValue={winRange} />
              </th>
              <th className="text-right pb-2 font-medium pr-4">
                <HeaderTip label={`Growth (${winShort})`} title="Growth"
                  body="(Active now − Active at the start of the window) ÷ Active at the start of the window."
                  basisLabel="Window" basisValue={winRange} />
              </th>
              <th className="text-right pb-2 font-medium pr-4">
                <HeaderTip label={`Gross Churn (${winShort})`} title="Gross Churn"
                  body="Stopped ÷ Active at the start of the window."
                  basisLabel="Window" basisValue={winRange} />
              </th>
              <th className="text-right pb-2 font-medium pr-4">
                <HeaderTip label={`Net Churn (${winShort})`} title="Net Churn"
                  body="(Stopped − Reactivated) ÷ Active at the start of the window."
                  basisLabel="Window" basisValue={winRange} />
              </th>
              <th className="text-right pb-2 font-medium pr-4">
                <HeaderTip label={`Quick Ratio (${winShort})`} title="Quick Ratio"
                  body="Started ÷ Stopped over the window (Started already includes reactivations). Above 1× means the base is growing."
                  basisLabel="Window" basisValue={winRange} />
              </th>
              <th className="text-right pb-2 font-medium">
                <HeaderTip label="% of Base" title="% of Base"
                  body="This line's Active ÷ All Lines Active."
                  basisLabel="As of" basisValue={priorDay} />
              </th>
            </tr>
          </thead>
          <tbody>
            {/* SXM Total — same format as every other line; caret expands the Internet/Satellite detail. */}
            <tr className="border-b border-slate-100 hover:bg-slate-50">
              <td className="py-2.5 pr-4 font-medium text-slate-800">
                <button type="button" onClick={() => setExpandSxm((v) => !v)}
                  className="inline-flex items-center gap-1 hover:text-primary">
                  {expandSxm ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                  SXM Total
                </button>
              </td>
              <MetricCells m={sxmTotal} />
            </tr>
            {expandSxm && sxmChildren.map((r) => (
              <tr key={r.key} className="border-b border-slate-100 hover:bg-slate-50 text-slate-600">
                <td className="py-2.5 pr-4 pl-8">{r.label}</td>
                <MetricCells m={r} />
              </tr>
            ))}
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2.5 pr-4 font-medium text-slate-800">{r.label}</td>
                <MetricCells m={r} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
              <td className="py-2.5 pr-4">All Lines</td>
              <MetricCells m={total} />
            </tr>
          </tfoot>
        </table>
      </InsightsSection>

      {/* Excel-style monthly detail (the "Report - Service Counts" sheet layout) — always current. */}
      <InsightsSection title="Service Counts By Month"
        lastUpdated={freshness.lastUpdated} nextUpdate={freshness.nextUpdate} updateEveryMinutes={freshness.updateEveryMinutes}>
        <ServiceCountsDetailTable ds={ds} />
      </InsightsSection>
    </div>
    </TooltipProvider>
  )
}
