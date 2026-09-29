/**
 * The five headline KPIs shown above the Activity Timeline.
 *
 * These render through the shared Insights `KpiTile` (see HeaderMetrics), so the
 * Productivity drill-down is identical to the Quality and Coaching KPI cards —
 * same card, status dot, (i) info popover and vs-prior delta. Each entry maps a
 * registered KPI code (see kpiDefs.ts) to the value it reads off the day model;
 * the tile itself owns all formatting and presentation.
 *
 * Sales gets its own set: its agents are measured on the work they move
 * (leads, proposals, emails) rather than call handling and ticket throughput.
 */
import type { KpiBasisRow } from '@/components/insights/KpiInfoCard'
import type { ProductivityArea } from '@/services/insightsService'
import { fmtHM, type DayModel } from './productivityModel'
import { PROPOSAL_LABEL } from './productivitySalesModel'
import type { ProductivityRosterRow } from './productivityTypes'

const hours = (m: DayModel) => Math.max(0.01, m.clockedMin / 60)

export interface ProductivityKpi {
  /** Registered KPI code in kpiDefs.ts — drives name, format, thresholds, info. */
  code: string
  /** The value for the selected day, read off the already-built day model (or,
   *  for roster-computed figures like desk utilization, the agent's roster row). */
  value: (m: DayModel, row: ProductivityRosterRow | null) => number | null
  /** The figures behind the value, shown in the tile's (i) card. */
  basis?: (m: DayModel, row: ProductivityRosterRow | null) => KpiBasisRow[]
}

export const PRODUCTIVITY_KPIS: ProductivityKpi[] = [
  { code: 'aa_prod_utilization',      value: m => m.utilizationPct },
  { code: 'aa_prod_handle_time',      value: m => m.callSummary.ahtMins },
  { code: 'aa_prod_calls_per_hour',   value: m => m.callSummary.answered / hours(m) },
  { code: 'aa_prod_tickets_per_hour', value: m => m.ticketTotals.total / hours(m) },
  { code: 'aa_prod_missed_calls',     value: m => m.callSummary.missed },
]

export const SALES_PRODUCTIVITY_KPIS: ProductivityKpi[] = [
  {
    code: 'aa_prod_utilization',
    value: m => m.utilizationPct,
    basis: m => [{ label: 'On a call', value: `${fmtHM(m.onCallMin)} of ${fmtHM(m.clockedMin)} paid` }],
  },
  {
    code: 'aa_prod_desk_utilization',
    value: (_m, row) => row?.deskUtilizationPct ?? null,
    basis: (_m, row) => row && row.deskProductiveMin !== null
      ? [
          { label: 'Productive desk', value: fmtHM(row.deskProductiveMin) },
          { label: 'In warehouse', value: fmtHM(row.warehouseMin) },
          { label: 'Paid time', value: fmtHM(row.clockedMin) },
        ]
      : [{ label: 'Desk time', value: 'No DeskTime data for this day' }],
  },
  {
    code: 'aa_prod_leads_touched',
    value: m => (m.sales ? m.sales.totals.leadsTouched + m.sales.totals.contactManagerTouched : 0),
    basis: m => [
      { label: 'Lead Manager', value: String(m.sales?.totals.leadsTouched ?? 0) },
      { label: 'Contact Manager', value: String(m.sales?.totals.contactManagerTouched ?? 0) },
    ],
  },
  {
    code: 'aa_prod_proposals_issued',
    value: m => m.sales?.totals.proposals ?? 0,
    basis: m => {
      const by = m.sales?.totals.proposalsByType
      return (Object.keys(PROPOSAL_LABEL) as (keyof typeof PROPOSAL_LABEL)[])
        .filter(t => t !== 'unclassified' || (by?.unclassified ?? 0) > 0)
        .map(t => ({ label: PROPOSAL_LABEL[t], value: String(by?.[t] ?? 0) }))
    },
  },
  {
    code: 'aa_prod_emails_sent',
    value: m => m.sales?.totals.emailsSent ?? 0,
  },
]

export const kpisForArea = (area: ProductivityArea): ProductivityKpi[] =>
  area === 'sales' ? SALES_PRODUCTIVITY_KPIS : PRODUCTIVITY_KPIS
