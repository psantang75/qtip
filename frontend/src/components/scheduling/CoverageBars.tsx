/**
 * MOCKUP — Phase 1 design probe only.
 *
 * The coverage timeline itself: a stacked bar per slot across the day axis,
 * height = how many are scheduled at that moment, colour = how the working
 * count grades against the department's time-of-day thresholds. Exceptions sit
 * on top (amber), then breaks (slate), then the working band (graded) — the
 * same colour language as a person's shift bar, read as a headcount instead of
 * one schedule.
 *
 * Shared by the day view's full-height strip (DeptCoverageStrip) and the week /
 * period grid's shrunk per-day version (DeptCoverageRow), so the two never
 * drift. Absolutely positioned, so the caller owns the box and its height.
 */
import { cn } from '@/lib/utils'
import type { MockPerson } from './mockScheduleData'
import {
  buildCoverage, COVERAGE_CLS, COVERAGE_LABEL, hourLabel, slotLevel,
  type CoverageWindow, type DayAxis,
} from './scheduleTime'

interface Props {
  members: MockPerson[]
  date: string
  axis: DayAxis
  windows: CoverageWindow[]
  /** Native per-slot tooltips — useful on the roomy day view, noise on the grid. */
  withTitles?: boolean
}

export function CoverageBars({ members, date, axis, windows, withTitles }: Props) {
  const coverage = buildCoverage(members, date, axis)
  const maxScheduled = Math.max(1, ...coverage.map(s => s.working + s.onBreak + s.onException))
  const pct = (n: number) => `${(n / maxScheduled) * 100}%`

  return (
    <div className="absolute inset-0 flex items-end">
      {coverage.map(slot => {
        const scheduled = slot.working + slot.onBreak + slot.onException
        const level = slotLevel(slot, windows)
        return (
          <div
            key={slot.startMin}
            className="flex h-full flex-1 flex-col justify-end"
            title={withTitles
              ? `${hourLabel(slot.startMin)} \u00b7 ${COVERAGE_LABEL[level]} \u2014 ${slot.working} working, ${slot.onBreak} on break, ${slot.onException} on exception`
              : undefined}
          >
            <div className="w-full bg-warning/25" style={{ height: pct(slot.onException) }} />
            <div className="w-full bg-slate-200" style={{ height: pct(slot.onBreak) }} />
            {/* A staffed slot with nobody working still gets a sliver, so the red
                is visible rather than collapsing to zero height. */}
            <div
              className={cn('w-full', COVERAGE_CLS[level])}
              style={{ height: pct(Math.max(slot.working, scheduled ? 0.35 : 0)) }}
            />
          </div>
        )
      })}
    </div>
  )
}
