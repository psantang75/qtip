import { useMemo } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import ActivityGantt from './ActivityGantt'
import HeaderMetrics from './HeaderMetrics'
import TimeSpentPanel from './TimeSpentPanel'
import { buildDayModel } from './productivityModel'
import { getAgentDay } from './productivitySampleData'

/**
 * Per-agent, per-day drill-down shown inline when a roster row is expanded.
 *
 * Read top to bottom as three tiers: the KPI strip says whether the day was good
 * and which way it is trending, the timeline says how it ran, and the panel
 * beneath says whether it was out of line with the people doing the same job.
 *
 * Deliberately excluded: anything scoring the punch against the schedule. Late
 * arrivals, early departures, grace and points are owned end to end by the CSR
 * Attendance report, and a second scoring engine over the same two sources would
 * only produce a number that disagrees with the official one. The planned shift
 * appears here as context on the Clock row, never as a score.
 *
 * Sample data only until the Phase 2 data layer + DeskTime API land.
 */
export default function ProductivityDayTimeline({ agent, date }: { agent: string; date: string }) {
  const model = useMemo(() => buildDayModel(getAgentDay(agent, date)), [agent, date])
  // The prior calendar day feeds each KPI tile's "vs prior" delta.
  const priorModel = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    const prev = new Date(y, m - 1, d - 1)
    const iso = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
    const pm = buildDayModel(getAgentDay(agent, iso))
    return pm.hasData ? pm : null
  }, [agent, date])

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {!model.hasData ? (
          <p className="py-10 text-center text-sm text-slate-400">No shift data for {agent} on this day.</p>
        ) : (
          <>
            <HeaderMetrics model={model} priorModel={priorModel} />

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-[13px] font-semibold text-slate-800">Activity Timeline</div>
              <ActivityGantt model={model} />
            </div>

            <TimeSpentPanel agent={agent} date={date} model={model} />
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
