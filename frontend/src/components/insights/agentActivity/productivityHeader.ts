/**
 * The five headline KPIs shown above the Activity Timeline.
 *
 * These render through the shared Insights `KpiTile` (see HeaderMetrics), so the
 * Productivity drill-down is identical to the Quality and Coaching KPI cards —
 * same card, status dot, (i) info popover and vs-prior delta. Each entry maps a
 * registered KPI code (see kpiDefs.ts) to the value it reads off the day model;
 * the tile itself owns all formatting and presentation.
 */
import type { DayModel } from './productivityModel'

const hours = (m: DayModel) => Math.max(0.01, m.clockedMin / 60)

export interface ProductivityKpi {
  /** Registered KPI code in kpiDefs.ts — drives name, format, thresholds, info. */
  code: string
  /** The value for the selected day, read off the already-built day model. */
  value: (m: DayModel) => number
}

export const PRODUCTIVITY_KPIS: ProductivityKpi[] = [
  { code: 'aa_prod_utilization',      value: m => m.utilizationPct },
  { code: 'aa_prod_handle_time',      value: m => m.callSummary.ahtMins },
  { code: 'aa_prod_calls_per_hour',   value: m => m.callSummary.answered / hours(m) },
  { code: 'aa_prod_tickets_per_hour', value: m => m.ticketTotals.total / hours(m) },
  { code: 'aa_prod_missed_calls',     value: m => m.callSummary.missed },
]
