import { useMemo, useState } from 'react'
import { createColumnHelper, type SortingState } from '@tanstack/react-table'
import { InsightsSection } from '@/components/insights'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { fmtNum, fmtAmount, fmtPct, fmtPctInt } from '@/components/insights/agentActivity/format'
import {
  marginLeadsRows, marginDealsRows, marginRows, marginCustomerRows, DATA_LAST_UPDATED,
  type MarginLeadsRow, type MarginDealsRow, type MarginRow, type MarginCustomerRow,
} from '@/components/insights/agentActivity/placeholderData'

const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0)

const BY_AGENT: SortingState = [{ id: 'agent', desc: false }]

// ── Table 1 — Leads by Salesperson ─────────────────────────────────────────────
const lc = createColumnHelper<MarginLeadsRow>()
const leadsColumns = [
  lc.accessor('agent',            { header: 'Salesperson',       cell: i => i.getValue(),               meta: { width: 'w-[34%]' } }),
  lc.accessor('totalLeads',       { header: 'Total Leads',       cell: i => fmtNum(i.getValue()),       meta: { width: 'w-[22%]' } }),
  lc.accessor('totalConversions', { header: 'Total Conversions', cell: i => fmtNum(i.getValue()),       meta: { width: 'w-[22%]' } }),
  lc.accessor('conversionPct',    { header: 'Lead Conversion %', cell: i => fmtPct(i.getValue(), 1),    meta: { width: 'w-[22%]' } }),
]
const leadsTotalLeads = sum(marginLeadsRows, r => r.totalLeads)
const leadsTotalConv  = sum(marginLeadsRows, r => r.totalConversions)
const leadsTotalRow = {
  agent: `Total: ${marginLeadsRows.length}`,
  totalLeads: fmtNum(leadsTotalLeads),
  totalConversions: fmtNum(leadsTotalConv),
  conversionPct: fmtPct(leadsTotalConv / leadsTotalLeads * 100, 1),
}

// ── Table 2 — Deals and Subscriptions by Salesperson ────────────────────────────
const dc = createColumnHelper<MarginDealsRow>()
const dealsColumns = [
  dc.accessor('agent',        { header: 'Salesperson',   cell: i => i.getValue(),         meta: { width: 'w-[22%]' } }),
  dc.accessor('deals',        { header: 'Deals',         cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('totalSubs',    { header: 'Total Subs',    cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subPace',      { header: 'Sub Pace',      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subOnlyDeals', { header: 'Sub Only Deals', cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subOnly',      { header: 'Sub Only',      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[13%]' } }),
  dc.accessor('subOnlyPct',   { header: 'Sub Only %',    cell: i => fmtPct(i.getValue(), 1), meta: { width: 'w-[13%]' } }),
]
const dealsSubsTotal = sum(marginDealsRows, r => r.totalSubs)
const dealsSubOnly   = sum(marginDealsRows, r => r.subOnly)
const dealsTotalRow = {
  agent: `Total: ${marginDealsRows.length}`,
  deals: fmtNum(sum(marginDealsRows, r => r.deals)),
  totalSubs: fmtNum(dealsSubsTotal),
  subPace: fmtNum(sum(marginDealsRows, r => r.subPace)),
  subOnlyDeals: fmtNum(sum(marginDealsRows, r => r.subOnlyDeals)),
  subOnly: fmtNum(dealsSubOnly),
  subOnlyPct: fmtPct(dealsSubOnly / dealsSubsTotal * 100, 1),
}

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
  mc.accessor('pace',        { header: 'Margin Pace',         cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('perDeal',     { header: 'Total Margin / Deal', cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('perSub',      { header: 'Total Margin / Sub',  cell: i => fmtAmount(i.getValue()),    meta: { width: W } }),
  mc.accessor('warrantyPct', { header: 'Warranty Margin %',   cell: i => fmtPctInt(i.getValue()),    meta: { width: W } }),
  mc.accessor('shippingPct', { header: 'Shipping Margin %',   cell: i => fmtPctInt(i.getValue()),    meta: { width: W } }),
]
const marginTotal = sum(marginRows, r => r.total)
const marginTotalRow = {
  agent: `Total: ${marginRows.length}`,
  product: fmtAmount(sum(marginRows, r => r.product)),
  install: fmtAmount(sum(marginRows, r => r.install)),
  shipping: fmtAmount(sum(marginRows, r => r.shipping)),
  warranty: fmtAmount(sum(marginRows, r => r.warranty)),
  total: fmtAmount(marginTotal),
  pace: fmtAmount(sum(marginRows, r => r.pace)),
  perDeal: fmtAmount(marginTotal / sum(marginDealsRows, r => r.deals)),
  perSub: fmtAmount(marginTotal / sum(marginDealsRows, r => r.totalSubs)),
  warrantyPct: fmtPctInt(sum(marginRows, r => r.warranty) / marginTotal * 100),
  shippingPct: fmtPctInt(sum(marginRows, r => r.shipping) / marginTotal * 100),
}

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
// Leaderboard is ranked by total margin desc; the dropdown caps how many of the
// top customers are shown (default 15, up to 50 by 5).
const LEADERBOARD_LIMITS = [15, 20, 25, 30, 35, 40, 45, 50]
const customersByMargin = [...marginCustomerRows].sort((a, b) => b.total - a.total)

export default function AAMarginPage() {
  const [leaderboardLimit, setLeaderboardLimit] = useState(15)
  const topCustomers = useMemo(
    () => customersByMargin.slice(0, leaderboardLimit),
    [leaderboardLimit],
  )

  return (
    <ActivityReportShell
      title="Sales Margin"
      description="Leads, deals, subscriptions, and margin by salesperson and customer."
    >
      <InsightsSection title="Leads by Salesperson — Based on Lead Created Date" lastUpdated={DATA_LAST_UPDATED}>
        <SortableTable
          columns={leadsColumns}
          data={marginLeadsRows}
          initialSorting={BY_AGENT}
          totalRow={leadsTotalRow}
          minWidth="min-w-[560px]"
        />
      </InsightsSection>

      <InsightsSection title="Deals and Subscriptions by Salesperson — Based on Margin Eligibility Date" lastUpdated={DATA_LAST_UPDATED}>
        <SortableTable
          columns={dealsColumns}
          data={marginDealsRows}
          initialSorting={BY_AGENT}
          totalRow={dealsTotalRow}
          minWidth="min-w-[760px]"
        />
      </InsightsSection>

      <InsightsSection title="Margin by Salesperson" lastUpdated={DATA_LAST_UPDATED}>
        <SortableTable
          columns={marginColumns}
          data={marginRows}
          initialSorting={BY_AGENT}
          totalRow={marginTotalRow}
          minWidth="min-w-[1040px]"
        />
      </InsightsSection>

      <InsightsSection title="Margin by Customer Leaderboard" lastUpdated={DATA_LAST_UPDATED}>
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
