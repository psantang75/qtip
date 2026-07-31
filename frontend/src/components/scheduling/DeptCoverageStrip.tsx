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
import { thresholdFor, type MockPerson } from './mockScheduleData'
import {
  buildCoverage, coverageLevel, COVERAGE_CLS, COVERAGE_LABEL, hourLabel, peakAway, troughWorking,
  type DayAxis,
} from './scheduleTime'

interface Props {
  dept: string
  members: MockPerson[]
  date: string
  axis: DayAxis
  /** Column widths are owned by the timeline so the two stay aligned. */
  selCol: string
  nameCol: string
  gridlines: ReactNode
}

export function DeptCoverageStrip({
  dept, members, date, axis, selCol, nameCol, gridlines,
}: Props) {
  const coverage = buildCoverage(members, date, axis)
  const maxScheduled = Math.max(1, ...coverage.map(s => s.working + s.onBreak + s.onException))
  const threshold = thresholdFor(dept, members.length)
  const peak = peakAway(coverage)
  const trough = troughWorking(coverage)
  const troughLevel = coverageLevel(trough, maxScheduled, threshold)

  return (
    <div className="mt-2 flex items-stretch border-y border-slate-200 bg-slate-50/60">
      <div className={selCol} />
      <div className={cn(nameCol, 'border-r border-slate-200 px-3 py-1.5')}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Coverage
          </span>
          <span className="text-[10px] text-slate-400">
            green {threshold.green}+, red under {threshold.yellow}
          </span>
        </div>
        <div className={cn(
          'flex items-center gap-1 text-[10px] font-medium',
          troughLevel === 'green' ? 'text-slate-400' : 'text-destructive',
        )}>
          {troughLevel !== 'green' && <AlertTriangle className="h-3 w-3" />}
          low of {trough} &middot; peak {peak} away
        </div>
      </div>

      <div className="relative h-8 flex-1">
        {gridlines}
        <div className="absolute inset-0 flex items-end">
          {coverage.map(slot => {
            const scheduled = slot.working + slot.onBreak + slot.onException
            const level = coverageLevel(slot.working, scheduled, threshold)
            return (
              <div
                key={slot.startMin}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${hourLabel(slot.startMin)} \u00b7 ${COVERAGE_LABEL[level]} \u2014 ${slot.working} working, ${slot.onBreak} on break, ${slot.onException} on exception`}
              >
                <div
                  className="w-full bg-warning/25"
                  style={{ height: `${(slot.onException / maxScheduled) * 100}%` }}
                />
                <div
                  className="w-full bg-slate-200"
                  style={{ height: `${(slot.onBreak / maxScheduled) * 100}%` }}
                />
                {/* A staffed slot with nobody working still gets a sliver, so
                    the red is visible rather than collapsing to zero height. */}
                <div
                  className={cn('w-full', COVERAGE_CLS[level])}
                  style={{
                    height: `${(Math.max(slot.working, scheduled ? 0.35 : 0) / maxScheduled) * 100}%`,
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
