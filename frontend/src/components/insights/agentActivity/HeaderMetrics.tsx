import KpiTile from '@/components/insights/KpiTile'
import type { DayModel } from './productivityModel'
import { PRODUCTIVITY_KPIS } from './productivityHeader'

/**
 * The headline KPI strip above the Activity Timeline.
 *
 * Uses the shared Insights `KpiTile`, so it is identical to the Quality and
 * Coaching KPI cards — same card, threshold status dot, (i) info popover and
 * "vs prior period" delta. The grid mirrors those pages exactly.
 *
 * `priorModel` is the previous day with data; it feeds each tile's delta. When
 * there is no prior day (the earliest day in range) the delta is simply omitted.
 */
export default function HeaderMetrics({
  model, priorModel,
}: { model: DayModel; priorModel: DayModel | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {PRODUCTIVITY_KPIS.map(k => (
        <KpiTile
          key={k.code}
          kpiCode={k.code}
          value={k.value(model)}
          priorValue={priorModel ? k.value(priorModel) : undefined}
        />
      ))}
    </div>
  )
}
