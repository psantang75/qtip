import KpiTile from '@/components/insights/KpiTile'
import type { ProductivityArea } from '@/services/insightsService'
import type { DayModel } from './productivityModel'
import { kpisForArea } from './productivityHeader'
import type { ProductivityRosterRow } from './productivityTypes'

/**
 * The headline KPI strip above the Activity Timeline.
 *
 * Uses the shared Insights `KpiTile`, so it is identical to the Quality and
 * Coaching KPI cards — same card, threshold status dot, (i) info popover and
 * "vs prior period" delta. The grid mirrors those pages exactly.
 *
 * `priorModel` is the previous day with data; it feeds each tile's delta. When
 * there is no prior day (the earliest day in range) the delta is simply omitted.
 * The roster rows carry the figures only the roster computes (desk utilization).
 */
export default function HeaderMetrics({
  area, model, priorModel, row, priorRow,
}: {
  area: ProductivityArea
  model: DayModel
  priorModel: DayModel | null
  row: ProductivityRosterRow | null
  priorRow: ProductivityRosterRow | null
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {kpisForArea(area).map(k => (
        <KpiTile
          key={k.code}
          kpiCode={k.code}
          value={k.value(model, row)}
          priorValue={priorModel ? k.value(priorModel, priorRow) ?? undefined : undefined}
          basis={k.basis?.(model, row)}
        />
      ))}
    </div>
  )
}
