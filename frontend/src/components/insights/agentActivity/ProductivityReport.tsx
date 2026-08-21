import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsSection, ExpandableRow } from '@/components/insights'
import { cn } from '@/lib/utils'
import ProductivityDayTimeline from './ProductivityDayTimeline'
import { fmtNum } from './format'
import { fmtHM, fmtMS } from './productivityModel'
import { METRIC_TEXT, UTILIZATION_TARGET, stateFor } from './productivityStatus'
import { getProductivityRoster, type ProductivityArea } from '@/services/insightsService'
import { PageSpinner } from '@/components/common/PageSpinner'

/**
 * The Productivity report body shared by the Sales and CSR pages: a roster where
 * each row expands (caret) to an inline, full-width day drill-down — the standard
 * Insights disclosure pattern. `agentLabel` swaps the first column header
 * ("Salesperson" vs "Agent") to match the section.
 *
 * The columns mirror the drill-down's header tiles, so the collapsed and expanded
 * views never disagree: Utilization (the headline), Calls per hour and Avg handle
 * time (the two rate metrics a manager triages on), and Missed calls (the one
 * exception signal). Occupancy and raw call counts are deliberately absent — occupancy
 * describes how busy the queue was rather than the agent, and volume belongs to
 * Call Activity; punch-vs-schedule scoring belongs to Attendance. Clocked stays
 * only as the denominator the rest are read against.
 *
 * The roster is read live for the selected day; each row carries the agent's
 * employee_key so the drill-down and the department comparison read the same day.
 */

// Header and each row's summary share this template so columns line up without
// a real table (mirrors AttendancePointsRoster). The lead column reserves space
// for the ExpandableRow caret via pl-6 in the header.
const GRID = 'grid grid-cols-[minmax(160px,1.6fr)_repeat(5,1fr)] gap-x-3 items-center'

interface ProductivityReportProps {
  agentLabel: string
  date: string
  area: ProductivityArea
  /** Filter-bar selection; empty means "all". */
  selectedUsers: string[]
  selectedDepts: string[]
}

export default function ProductivityReport({ agentLabel, date, area, selectedUsers, selectedDepts }: ProductivityReportProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['productivity-roster', area, date],
    queryFn: () => getProductivityRoster(area, date),
  })

  // The full roster still feeds the department comparison medians (peers are the
  // whole team, not the filtered view), so filtering only narrows the table.
  const roster = useMemo(() => data?.rows ?? [], [data])
  // Highest utilization first: the manager's question is how well the clocked
  // time is being used, so that ranking surfaces at the top.
  const rows = useMemo(
    () => roster
      .filter(r => selectedUsers.length === 0 || selectedUsers.includes(r.agent))
      .filter(r => selectedDepts.length === 0 || selectedDepts.includes(r.department))
      .sort((a, b) => b.utilizationPct - a.utilizationPct),
    [roster, selectedUsers, selectedDepts],
  )

  return (
    <InsightsSection title="Productivity by Agent">
      {isLoading ? (
        <PageSpinner />
      ) : isError ? (
        <p className="py-10 text-center text-sm text-destructive">Failed to load productivity for this day.</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No agents in scope for this day.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className={`${GRID} border-b border-slate-200 px-3 pb-2 text-xs text-slate-400`}>
              <span className="pl-6">{agentLabel}</span>
              <span className="text-right">Paid time</span>
              <span className="text-right">Utilization</span>
              <span className="text-right">Calls per hour</span>
              <span className="text-right">Avg handle time</span>
              <span className="text-right">Missed calls</span>
            </div>

            <div className="pt-2">
              {rows.map(r => (
                <ExpandableRow
                  key={r.agent}
                  isExpanded={expanded === r.agent}
                  onToggle={() => setExpanded(prev => (prev === r.agent ? null : r.agent))}
                  summary={
                    <span className={GRID}>
                      <span className="truncate text-slate-700">{r.agent}</span>
                      <span className="text-right tabular-nums text-slate-600">{fmtHM(r.clockedMin)}</span>
                      <span className={cn('text-right font-semibold tabular-nums', METRIC_TEXT[stateFor(r.utilizationPct, UTILIZATION_TARGET)])}>
                        {r.utilizationPct}%
                      </span>
                      <span className="text-right tabular-nums text-slate-600">{r.callsPerHour.toFixed(1)}</span>
                      <span className="text-right tabular-nums text-slate-600">{fmtMS(r.ahtMins)}</span>
                      <span className={r.missedCalls > 0 ? 'text-right font-semibold tabular-nums text-destructive' : 'text-right tabular-nums text-slate-400'}>
                        {fmtNum(r.missedCalls)}
                      </span>
                    </span>
                  }
                  detail={expanded === r.agent
                    ? <ProductivityDayTimeline area={area} employeeKey={r.employeeKey} agent={r.agent} date={date} roster={roster} />
                    : null}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </InsightsSection>
  )
}
