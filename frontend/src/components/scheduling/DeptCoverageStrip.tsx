/**
 * MOCKUP — Phase 1 design probe only.
 *
 * Coverage sits with its department rather than under the whole page, because
 * "four people are working" means something different for a nine-person queue
 * than for a two-person one, and a combined strip hides a department that is
 * dark behind one that is overstaffed.
 *
 * Bar height is how many are scheduled at that moment. Bar colour grades that
 * against the department's own minimums — green, yellow, red — so a hole reads
 * before anyone counts rows.
 */
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { MockPerson } from './mockScheduleData'
import { CoverageBars } from './CoverageBars'
import {
  buildCoverage, fmtCompact, hhmmOf, peakAway,
  troughWorking, worstCoverageLevel, type CoverageWindow, type DayAxis,
} from './scheduleTime'

interface Props {
  members: MockPerson[]
  date: string
  axis: DayAxis
  /** Live per-department time-of-day staffing bars from Coverage settings. */
  windows: CoverageWindow[]
  /** Column widths are owned by the timeline so the two stay aligned. */
  selCol: string
  nameCol: string
  gridlines: ReactNode
}

/** '8:30a–5p 2+' per window, joined — the day's staffing expectation in a line. */
function summarize(windows: CoverageWindow[]): string {
  return windows
    .map(w => `${fmtCompact(hhmmOf(w.startMin))}\u2013${fmtCompact(hhmmOf(w.endMin))} ${w.green}+`)
    .join('  \u00b7  ')
}

export function DeptCoverageStrip({
  members, date, axis, windows, selCol, nameCol, gridlines,
}: Props) {
  const coverage = buildCoverage(members, date, axis)
  const peak = peakAway(coverage)
  const trough = troughWorking(coverage, windows)
  const worst = worstCoverageLevel(coverage, windows)

  return (
    <div className="mt-2 flex items-stretch border-y border-slate-200 bg-slate-50/60">
      <div className={selCol} />
      <div className={cn(nameCol, 'border-r border-slate-200 px-3 py-1.5')}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Coverage
          </span>
          <span className="truncate text-[10px] text-slate-400" title={summarize(windows)}>
            {summarize(windows)}
          </span>
        </div>
        <div className={cn(
          'flex items-center gap-1 text-[10px] font-medium',
          worst === 'green' || worst === 'closed' ? 'text-slate-400' : 'text-destructive',
        )}>
          {worst !== 'green' && worst !== 'closed' && <AlertTriangle className="h-3 w-3" />}
          low of {trough} &middot; peak {peak} away
        </div>
      </div>

      <div className="relative h-8 flex-1">
        {gridlines}
        <CoverageBars members={members} date={date} axis={axis} windows={windows} withTitles />
      </div>
    </div>
  )
}
