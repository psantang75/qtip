/**
 * MOCKUP — Phase 1 design probe only.
 *
 * The week and period grids give each day a single narrow column, so the day
 * view's intraday coverage strip is shrunk to fit one: the same stacked bar
 * (CoverageBars) spanning that day's worked range, graded by the department's
 * time-of-day thresholds. It reads as a shape — a red dip is a hole at a glance
 * — and the hour-by-hour numbers live in the hover, following the ScheduleDayCell
 * / KpiInfoCard tooltip pattern.
 *
 * Rendered as a <tr> so it sits inside the grid's table and stays column-aligned
 * with the day headers above it.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { addDays, parseLocal, type MockPerson, type MockShift } from './mockScheduleData'
import { CoverageBars } from './CoverageBars'
import {
  buildDayAxis, COVERAGE_LABEL, dayCoverage, fmtCompact, hhmmOf, hourLabel,
  type CoverageLevel, type CoverageWindow,
} from './scheduleTime'

interface Props {
  dept: string
  members: MockPerson[]
  days: string[]
  weekStarts: string[]
  /** Live per-department time-of-day staffing bars from Coverage settings. */
  windows: CoverageWindow[]
  /** Column widths are owned by the grid so the two stay aligned. */
  selCol: string
  nameCol: string
  nameLeft: string
}

/** Readable text over the translucent heat fills. */
const TONE: Record<CoverageLevel, string> = {
  green: 'text-slate-700',
  yellow: 'text-amber-800',
  red: 'text-destructive',
  none: 'text-destructive',
  closed: 'text-slate-300',
}

export function DeptCoverageRow({
  dept, members, days, weekStarts, windows, selCol, nameCol, nameLeft,
}: Props) {
  const stickyCell = 'sticky z-10 border-b border-slate-200 bg-slate-50'
  const windowsSummary = windows
    .map(w => `${fmtCompact(hhmmOf(w.startMin))}\u2013${fmtCompact(hhmmOf(w.endMin))}: green ${w.green}+, red under ${w.yellow}`)
    .join('\n')
  // Two-week columns are half the width, so pack the strip into two-hour blocks
  // there and keep hourly resolution in the roomier week view.
  const blockMins = weekStarts.length > 1 ? 120 : 60

  return (
    <tr className="bg-slate-50">
      <td className={cn(selCol, 'left-0', stickyCell)} />
      <td className={cn(nameCol, nameLeft, stickyCell, 'border-r px-3 py-1.5')}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Coverage
        </span>
        <div className="text-[10px] text-slate-400">by time of day</div>
      </td>

      {days.map(iso => {
        const cov = dayCoverage(members, iso, windows, 15, blockMins)
        const dayShifts = members
          .map(p => p.shifts.find(s => s.date === iso))
          .filter((s): s is MockShift => !!s)
        const axis = buildDayAxis(dayShifts)
        const dividerRight = iso === addDays(weekStarts[0], 6) && weekStarts.length > 1
        const empty = dayShifts.length === 0

        return (
          <td
            key={iso}
            className={cn('border-b border-slate-100 p-1 align-middle', dividerRight && 'border-r border-r-slate-200')}
          >
            {empty ? (
              <div className="flex h-7 items-center justify-center text-[11px] text-slate-300">
                &mdash;
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* The day-view coverage strip, shrunk: a stacked bar spanning
                      this day's worked range, graded by the same thresholds. */}
                  <div className="relative h-7 w-full cursor-default">
                    <CoverageBars members={members} date={iso} axis={axis} windows={windows} />
                  </div>
                </TooltipTrigger>

                <TooltipContent side="bottom" className="w-[236px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="text-[13px] font-semibold text-slate-900">{dept} coverage</div>
                  <div className="mb-2 text-[12.5px] leading-relaxed text-slate-600">
                    {parseLocal(iso).toLocaleDateString('en-US', {
                      weekday: 'long', month: 'short', day: 'numeric',
                    })}{' '}
                    &middot; {COVERAGE_LABEL[cov.level].toLowerCase()} at its thinnest.
                  </div>

                  <div className="space-y-1 border-t border-slate-100 pt-2">
                    <Row label="Low of" value={`${cov.trough} working`} />
                    <Row label="Peak" value={`${cov.scheduled} scheduled`} />
                    <Row label="Frames" value={<span className="whitespace-pre-line text-right text-[11px]">{windowsSummary}</span>} />
                  </div>

                  <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
                    {cov.hours.filter(h => h.level !== 'closed').map(h => {
                      const away = h.onBreak + h.onException
                      const label = blockMins > 60
                        ? `${hourLabel(h.startMin)}\u2013${hourLabel(h.endMin)}`
                        : hourLabel(h.startMin)
                      return (
                        <div key={h.startMin} className="flex items-baseline justify-between gap-4">
                          <span className="text-[11px] tabular-nums text-slate-400">{label}</span>
                          <span className={cn('text-[11px] font-medium tabular-nums', TONE[h.level])}>
                            {h.working} working
                            {away > 0 && (
                              <span className="font-normal text-slate-400"> &middot; {away} away</span>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </td>
        )
      })}
    </tr>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-[12px] font-medium text-slate-700">{value}</span>
    </div>
  )
}
