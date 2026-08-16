import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TooltipProvider } from '@/components/ui/tooltip'
import ActivityGantt from './ActivityGantt'
import HeaderMetrics from './HeaderMetrics'
import MetricTooltip from './MetricTooltip'
import TimeSpentPanel from './TimeSpentPanel'
import { buildDayModel, fmtHM } from './productivityModel'
import { buildHeaderTiles } from './productivityHeader'
import { getAgentDay, SAMPLE_DATES, SAMPLE_DATE_LABELS } from './productivitySampleData'
import { METRIC_TEXT, OCCUPANCY_TARGET, stateFor } from './productivityStatus'

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
export default function ProductivityDayTimeline({ agent }: { agent: string }) {
  const [date, setDate] = useState<string>(SAMPLE_DATES[SAMPLE_DATES.length - 1])
  const model = useMemo(() => buildDayModel(getAgentDay(agent, date)), [agent, date])
  const tiles = useMemo(() => (model.hasData ? buildHeaderTiles(agent, date, model) : []), [agent, date, model])

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {/* The day being read, and the shape of it in one line. Occupancy lives
            here rather than in a tile: it describes how busy the queue was, so it
            is context for the tiles, not a judgement on the agent. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {model.hasData && (
              <>
                <span>
                  Clocked <span className="font-medium tabular-nums text-slate-700">{fmtHM(model.clockedMin)}</span>
                </span>
                <span>·</span>
                <span>
                  On queue <span className="font-medium tabular-nums text-slate-700">{fmtHM(model.onQueueMin)}</span>
                </span>
                <span>·</span>
                <MetricTooltip
                  title="Occupancy"
                  description="Share of in-queue time actually spent on calls. Low occupancy means the queue was quiet, not that the agent was."
                  rows={[
                    { label: 'On a call', value: fmtHM(model.onCallMin) },
                    { label: 'Of on-queue time', value: fmtHM(model.onQueueMin) },
                    { label: 'Target', value: `${OCCUPANCY_TARGET.good}%` },
                  ]}
                >
                  <span className="cursor-help">
                    Occupancy{' '}
                    <span className={cn('font-semibold tabular-nums', METRIC_TEXT[stateFor(model.occupancyPct, OCCUPANCY_TARGET)])}>
                      {model.occupancyPct}%
                    </span>
                  </span>
                </MetricTooltip>
                <span>·</span>
                <span className="tabular-nums">{model.windowLabel}</span>
              </>
            )}
          </div>
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger className="h-8 w-[150px] bg-white text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SAMPLE_DATES.map(d => (
                <SelectItem key={d} value={d}>{SAMPLE_DATE_LABELS[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!model.hasData ? (
          <p className="py-10 text-center text-sm text-slate-400">No shift data for {agent} on {SAMPLE_DATE_LABELS[date]}.</p>
        ) : (
          <>
            <HeaderMetrics tiles={tiles} />

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-[13px] font-semibold text-slate-800">Activity Timeline · {SAMPLE_DATE_LABELS[date]}</div>
              <ActivityGantt model={model} />
            </div>

            <TimeSpentPanel agent={agent} date={date} model={model} />
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
