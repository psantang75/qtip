import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import ActivityGantt from './ActivityGantt'
import HeaderMetrics from './HeaderMetrics'
import TimeSpentPanel from './TimeSpentPanel'
import { buildDayModel } from './productivityModel'
import { getProductivityDay, type ProductivityArea } from '@/services/insightsService'
import type { ProductivityRosterRow } from './productivityTypes'
import { PageSpinner } from '@/components/common/PageSpinner'

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
 * The day is read live on expand (punch clock, Genesys, CRM); the prior calendar
 * day feeds each KPI tile's "vs prior" delta. The roster is passed in so the
 * department comparison reads the same day the table above was built from.
 */

/** ISO date `days` before the given ISO date (local-safe). */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

interface Props {
  area: ProductivityArea
  employeeKey: number
  agent: string
  date: string
  roster: ProductivityRosterRow[]
}

export default function ProductivityDayTimeline({ area, employeeKey, agent, date, roster }: Props) {
  const priorDate = useMemo(() => shiftDate(date, -1), [date])

  const dayQuery = useQuery({
    queryKey: ['productivity-day', area, employeeKey, date],
    queryFn: () => getProductivityDay(area, employeeKey, date),
  })
  const priorQuery = useQuery({
    queryKey: ['productivity-day', area, employeeKey, priorDate],
    queryFn: () => getProductivityDay(area, employeeKey, priorDate),
  })

  const model = useMemo(() => buildDayModel(dayQuery.data ?? null), [dayQuery.data])
  const priorModel = useMemo(() => {
    if (!priorQuery.data) return null
    const pm = buildDayModel(priorQuery.data)
    return pm.hasData ? pm : null
  }, [priorQuery.data])

  if (dayQuery.isLoading) return <div className="py-8"><PageSpinner /></div>
  if (dayQuery.isError) return <p className="py-10 text-center text-sm text-destructive">Failed to load this day.</p>

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {!model.hasData ? (
          <p className="py-10 text-center text-sm text-slate-400">No activity for {agent} on this day.</p>
        ) : (
          <>
            <HeaderMetrics model={model} priorModel={priorModel} />

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-[13px] font-semibold text-slate-800">Activity Timeline</div>
              <ActivityGantt model={model} />
            </div>

            <TimeSpentPanel agent={agent} model={model} roster={roster} />
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
