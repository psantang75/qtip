import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createColumnHelper, type SortingState } from '@tanstack/react-table'
import { Info } from 'lucide-react'
import { InsightsSection } from '@/components/insights'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { fmtNum, fmtAmount, fmtPct, fmtPctInt } from '@/components/insights/agentActivity/format'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import {
  getMargin,
  type MarginLeadsRow, type MarginDealsRow, type MarginRow, type MarginCustomerRow,
} from '@/services/insightsService'

const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0)

const BY_AGENT: SortingState = [{ id: 'agent', desc: false }]

// Pace columns project month-to-date figures to period end. The info icon
// explains the formula and points at the data-through date in the filter bar.
// stopPropagation keeps a click on the icon from toggling the column sort.
function PaceHeader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="text-slate-400 hover:text-slate-600"
              aria-label={`How ${label} is calculated`}
            >
              <Info className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            Pace = actual / business days with data x total business days in the period.
            Business days with data stop at the latest loaded date shown in the filter bar,
            so an unfinished or not-yet-loaded day doesn't drag the projection down.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  )
}

// ── Table 1 — Leads by Salesperson ─────────────────────────────────────────────
const lc = createColumnHelper<MarginLeadsRow>()
const leadsColumns = [
  lc.accessor('agent',            { header: 'Salesperson',       cell: i => i.getValue(),               meta: { width: 'w-[34%]' } }),
  lc.accessor('totalLeads',       { header: 'Total Leads',       cell: i => fmtNum(i.getValue()),       meta: { width: 'w-[22%]' } }),
  lc.accessor('totalConversions', { header: 'Total Conversions', cell: i => fmtNum(i.getValue()),       meta: { width: 'w-[22%]' } }),
  lc.accessor('conversionPct',    { header: 'Lead Conversion %', cell: i => fmtPct(i.getValue(), 1),    meta: { width: 'w-[22%]' } }),
]

// ── Table 2 — Deals and Subscriptions by Salesperson ────────────────────────────
const dc = createColumnHelper<MarginDealsRow>()
const dealsColumns = [
  dc.accessor('agent',        { header: 'Salesperson',   cell: i => i.getValue(),         meta: { width: 'w-[22%]' } }),
  dc.accessor('deals',        { header: 'Deals',         cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('totalSubs',    { header: 'Total Subs',    cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subPace',      { header: () => <PaceHeader label="Sub Pace" />, cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subOnlyDeals', { header: 'Sub Only Deals', cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subOnly',      { header: 'Sub Only',      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subOnlyPct',   { header: 'Sub Only %',    cell: i => fmtPct(i.getValue(), 1), meta: { width: 'w-[13%]' } }),
]

// ── Table 3 — Margin by Salesperson ─────────────────────────────────────────────
const mc = createColumnHelper<MarginRow>()
const W = 'w-[8.5%]'
const marginColumns = [
  mc.accessor('agent',       { header: 'Salesperson',         cell: i => i.getValue(),               meta: { width: 'w-[15%]' } }),
  mc.accessor('product',     { header: 'Product Margin',      cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('install',     { header: 'Install Margin',      cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('shipping',    { header: 'Shipping Margin',     cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('warranty',    { header: 'Warranty Margin',     cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('total',       { header: 'Total Margin',        cell: i => fmtAmount(i.getValue()),    meta: { width: W, bold: true } }),
  mc.accessor('pace',        { header: () => <PaceHeader label="Margin Pace" />, cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('perDeal',     { header: 'Total Margin / Deal', cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('perSub',      { header: 'Total Margin / Sub',  cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('warrantyPct', { header: 'Warranty Margin %',   cell: i => fmtPctInt(i.getValue()),    meta: { width: W } }),
  mc.accessor('shippingPct', { header: 'Shipping Margin %',   cell: i => fmtPctInt(i.getValue()),    meta: { width: W } }),
]

// ── Table 4 — Margin by Customer Leaderboard ────────────────────────────────────
const cc = createColumnHelper<MarginCustomerRow>()
const customerColumns = [
  cc.accessor('agent',    { header: 'Salesperson',     cell: i => i.getValue(),            meta: { width: 'w-[14%]' } }),
  cc.accessor('customer', { header: 'Customer Name',   cell: i => i.getValue(),            meta: { width: 'w-[18%]' } }),
  cc.accessor('product',  { header: 'Product Margin',  cell: i => fmtAmount(i.getValue()), meta: { width: 'w-[10%]' } }),
  cc.accessor('install',  { header: 'Install Margin',  cell: i => fmtAmount(i.getValue()), meta: { width: 'w-[10%]' } }),
  cc.accessor('shipping', { header: 'Shipping Margin', cell: i => fmtAmount(i.getValue()), meta: { width: 'w-[10%]' } }),
  cc.accessor('warranty', { header: 'Warranty Margin', cell: i => fmtAmount(i.getValue()), meta: { width: 'w-[10%]' } }),
  cc.accessor('total',    { header: 'Total Margin',    cell: i => fmtAmount(i.getValue()), meta: { width: 'w-[10%]', bold: true } }),
  cc.accessor('deals',    { header: 'Total Deals',     cell: i => fmtNum(i.getValue()),    meta: { width: 'w-[9%]' } }),
  cc.accessor('subs',     { header: 'Total Subs',      cell: i => fmtNum(i.getValue()),    meta: { width: 'w-[9%]' } }),
]

// Leaderboard is ranked by total margin desc (server-sorted); the dropdown caps
// how many of the top customers are shown (default 15, up to 50 by 5).
const LEADERBOARD_LIMITS = [15, 20, 25, 30, 35, 40, 45, 50]

export default function AAMarginPage() {
  const filters = useActivityFilters()
  const [leaderboardLimit, setLeaderboardLimit] = useState(15)

  const { data } = useQuery({
    queryKey: ['aa-margin', filters.params],
    queryFn:  () => getMargin(filters.params),
    // Filter-driven report; data also refreshes server-side nightly. Don't lean
    // on the global 5-min staleTime, which can serve a pre-change cached list.
    staleTime: 0,
  })

  const leadsRows    = useMemo(() => data?.leads ?? [],     [data])
  const dealsRows    = useMemo(() => data?.deals ?? [],     [data])
  const marginRows   = useMemo(() => data?.margin ?? [],    [data])
  const customerRows = useMemo(() => data?.customers ?? [], [data])
  const lastUpdated  = data?.dataLastUpdated ?? undefined
  const nextUpdate   = data?.dataNextUpdate ?? undefined
  const updateEveryMinutes = data?.updateEveryMinutes ?? undefined

  const leadsTotalRow = useMemo(() => {
    const tl = sum(leadsRows, r => r.totalLeads)
    const tc = sum(leadsRows, r => r.totalConversions)
    return {
      agent: `Total: ${leadsRows.length}`,
      totalLeads: fmtNum(tl),
      totalConversions: fmtNum(tc),
      conversionPct: fmtPct(tl ? tc / tl * 100 : 0, 1),
    }
  }, [leadsRows])

  const dealsTotalRow = useMemo(() => {
    const subs = sum(dealsRows, r => r.totalSubs)
    const subOnly = sum(dealsRows, r => r.subOnly)
    return {
      agent: `Total: ${dealsRows.length}`,
      deals: fmtNum(sum(dealsRows, r => r.deals)),
      totalSubs: fmtNum(subs),
      subPace: fmtNum(sum(dealsRows, r => r.subPace)),
      subOnlyDeals: fmtNum(sum(dealsRows, r => r.subOnlyDeals)),
      subOnly: fmtNum(subOnly),
      subOnlyPct: fmtPct(subs ? subOnly / subs * 100 : 0, 1),
    }
  }, [dealsRows])

  const marginTotalRow = useMemo(() => {
    const total = sum(marginRows, r => r.total)
    const warranty = sum(marginRows, r => r.warranty)
    const shipping = sum(marginRows, r => r.shipping)
    const totalDeals = sum(dealsRows, r => r.deals)
    const totalSubs = sum(dealsRows, r => r.totalSubs)
    return {
      agent: `Total: ${marginRows.length}`,
      product: fmtAmount(sum(marginRows, r => r.product)),
      install: fmtAmount(sum(marginRows, r => r.install)),
      shipping: fmtAmount(shipping),
      warranty: fmtAmount(warranty),
      total: fmtAmount(total),
      pace: fmtAmount(sum(marginRows, r => r.pace)),
      perDeal: fmtAmount(totalDeals ? total / totalDeals : 0),
      perSub: fmtAmount(totalSubs ? total / totalSubs : 0),
      warrantyPct: fmtPctInt(total ? warranty / total * 100 : 0),
      shippingPct: fmtPctInt(total ? shipping / total * 100 : 0),
    }
  }, [marginRows, dealsRows])

  const topCustomers = useMemo(
    () => customerRows.slice(0, leaderboardLimit),
    [customerRows, leaderboardLimit],
  )

  return (
    <ActivityReportShell
      title="Sales Margin"
      description="Leads, deals, subscriptions, and margin by salesperson and customer."
      filters={filters}
      availableUsers={data?.availableUsers ?? []}
      availableDepts={data?.availableDepartments ?? []}
      businessDays={data?.businessDaysElapsed}
      businessDaysTotal={data?.businessDaysTotal}
      dataThroughDate={data?.dataThroughDate}
      priorBusinessDays={data?.priorBusinessDays}
      priorDateRange={data?.priorDateRange ?? undefined}
      live
    >
      <InsightsSection title="Leads by Salesperson — Based on Lead Created Date" lastUpdated={lastUpdated} nextUpdate={nextUpdate} updateEveryMinutes={updateEveryMinutes}>
        <SortableTable
          columns={leadsColumns}
          data={leadsRows}
          initialSorting={BY_AGENT}
          totalRow={leadsTotalRow}
          minWidth="min-w-[560px]"
        />
      </InsightsSection>

      <InsightsSection title="Deals and Subscriptions by Salesperson — Based on Margin Eligibility Date" lastUpdated={lastUpdated} nextUpdate={nextUpdate} updateEveryMinutes={updateEveryMinutes}>
        <SortableTable
          columns={dealsColumns}
          data={dealsRows}
          initialSorting={BY_AGENT}
          totalRow={dealsTotalRow}
          minWidth="min-w-[760px]"
        />
      </InsightsSection>

      <InsightsSection title="Margin by Salesperson — Based on Margin Eligibility Date" lastUpdated={lastUpdated} nextUpdate={nextUpdate} updateEveryMinutes={updateEveryMinutes}>
        <SortableTable
          columns={marginColumns}
          data={marginRows}
          initialSorting={BY_AGENT}
          totalRow={marginTotalRow}
          minWidth="min-w-[1040px]"
        />
      </InsightsSection>

      <InsightsSection title="Margin by Customer Leaderboard — Based on Margin Eligibility Date" lastUpdated={lastUpdated} nextUpdate={nextUpdate} updateEveryMinutes={updateEveryMinutes}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-slate-500">Show Top</span>
          <Select value={String(leaderboardLimit)} onValueChange={v => setLeaderboardLimit(Number(v))}>
            <SelectTrigger className="h-8 w-[78px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEADERBOARD_LIMITS.map(n => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-medium text-slate-500">Customers by Total Margin</span>
        </div>
        <SortableTable
          columns={customerColumns}
          data={topCustomers}
          initialSorting={[{ id: 'total', desc: true }]}
          minWidth="min-w-[920px]"
        />
      </InsightsSection>
    </ActivityReportShell>
  )
}
