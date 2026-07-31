/**
 * MOCKUP — Phase 1 design probe only. Static props, no data fetching.
 *
 * One scheduled day. Two densities:
 *   'week'   — ~150px column, room to print the lunch window as text
 *   'period' — ~92px column in the two-week overview, ribbon only
 *
 * Either way the full seven times live in the hover tooltip, following the
 * KpiInfoCard layout in docs/design.md (the element itself is the trigger;
 * no info icon).
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { MockException, MockShift } from './mockScheduleData'
import {
  axisTicks, fmtCompact, fmtFull, fmtHours, minutesOf, paidMinutes, pctOf,
  SEGMENT_CLS, shiftSegments, type DayAxis,
} from './scheduleTime'

/**
 * Week view: the cell width is the whole day, so a late shift physically sits
 * to the right of an early one. Position carries as much meaning as duration,
 * which a full-width ribbon cannot show.
 */
function ScaledBar({
  shift, axis, muted, exceptions,
}: { shift: MockShift; axis: DayAxis; muted: boolean; exceptions: MockException[] }) {
  const l = pctOf(minutesOf(shift.start), axis)
  const w = pctOf(minutesOf(shift.end), axis) - l
  if (w <= 0) return null

  return (
    <div className="relative mt-1.5 h-2.5 w-full rounded-sm bg-slate-100">
      {/* Ticks mirror the column ruler so bar position can be read off it. */}
      {axisTicks(axis).slice(1, -1).map(m => (
        <span
          key={m}
          className="absolute inset-y-0 w-px bg-slate-200"
          style={{ left: `${pctOf(m, axis)}%` }}
        />
      ))}
      <div
        className={cn(
          'absolute inset-y-0 overflow-hidden rounded-sm border',
          muted ? 'border-slate-300 bg-slate-200' : 'border-primary/40 bg-primary/45',
        )}
        style={{ left: `${l}%`, width: `${w}%` }}
      >
        {shiftSegments(shift, exceptions).map((seg, i) => {
          const sl = pctOf(seg.startMin, axis)
          const sw = pctOf(seg.endMin, axis) - sl
          return (
            <span
              key={i}
              className={cn('absolute inset-y-0', SEGMENT_CLS[seg.kind])}
              style={{ left: `${((sl - l) / w) * 100}%`, width: `${Math.max((sw / w) * 100, 6)}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Period view: no room for a shared axis, so duration-relative only. */
function BreakRibbon({ shift, exceptions }: { shift: MockShift; exceptions: MockException[] }) {
  const start = minutesOf(shift.start)
  const total = minutesOf(shift.end) - start
  if (total <= 0) return null

  return (
    <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-primary/35">
      {shiftSegments(shift, exceptions).map((seg, i) => (
        <div
          key={i}
          className={cn('absolute inset-y-0 rounded-full', SEGMENT_CLS[seg.kind])}
          style={{
            left: `${((seg.startMin - start) / total) * 100}%`,
            width: `${Math.max(((seg.endMin - seg.startMin) / total) * 100, 4)}%`,
          }}
        />
      ))}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-[12px] font-medium text-slate-700">{value}</span>
    </div>
  )
}

interface CellProps {
  personName: string
  dateLabel: string
  shift?: MockShift
  exceptions: MockException[]
  isWeekend: boolean
  holidayName?: string
  variant?: 'week' | 'period'
  /** Shared day axis — week view only, so shifts line up across columns. */
  axis?: DayAxis
  onClick?: () => void
}

export function ScheduleDayCell({
  personName, dateLabel, shift, exceptions, isWeekend, holidayName,
  variant = 'period', axis, onClick,
}: CellProps) {
  const isWeek = variant === 'week'
  const minH = isWeek ? 'min-h-[66px]' : 'min-h-[46px]'

  if (holidayName) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-slate-50 px-1', minH)}>
        <span className="truncate text-[10px] font-medium text-slate-400">{holidayName}</span>
      </div>
    )
  }

  if (!shift) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group/empty h-full w-full',
          minH,
          isWeekend ? 'bg-slate-50' : 'bg-white hover:bg-primary/5',
        )}
      >
        {!isWeekend && (
          <span className="text-[11px] text-slate-200 group-hover/empty:text-primary">
            {isWeek ? '+ Add shift' : '\u2014'}
          </span>
        )}
      </button>
    )
  }

  const isDraft = shift.status === 'DRAFT'
  const worst = exceptions.find(e => !e.excused) ?? exceptions[0]
  const ordered = [...shift.breaks].sort((a, b) => minutesOf(a.start) - minutesOf(b.start))

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'h-full w-full px-1.5 py-1.5 text-left transition-colors hover:bg-primary/5',
            minH,
            isDraft && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(148,163,184,0.09)_5px,rgba(148,163,184,0.09)_10px)]',
            worst && (worst.excused
              ? 'border-l-2 border-l-warning bg-warning/[0.06]'
              : 'border-l-2 border-l-destructive bg-destructive/[0.06]'),
          )}
        >
          <div className={cn(
            'whitespace-nowrap font-semibold tabular-nums',
            isWeek ? 'text-[13px]' : 'text-[11px]',
            isDraft ? 'text-slate-400' : 'text-slate-800',
          )}>
            {fmtCompact(shift.start)}&ndash;{fmtCompact(shift.end)}
          </div>

          {isWeek && axis
            ? <ScaledBar shift={shift} axis={axis} muted={isDraft} exceptions={exceptions} />
            : <BreakRibbon shift={shift} exceptions={exceptions} />}

          {/* Breaks in the order they happen — break, lunch, break — so the
              line reads as the shape of the day rather than a grouping. */}
          {isWeek && ordered.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[10px] tabular-nums leading-tight text-slate-500">
              {ordered.map((b, i) => (
                <span key={i} className="whitespace-nowrap">
                  <span className={cn(
                    'font-bold',
                    b.kind === 'LUNCH' ? 'text-warning' : 'text-warning/70',
                  )}>
                    {b.kind === 'LUNCH' ? 'L' : 'B'}
                  </span>{' '}
                  {fmtCompact(b.start)}
                </span>
              ))}
            </div>
          )}

          {worst && (
            <div className={cn(
              'mt-0.5 truncate text-[10px] font-medium leading-tight',
              worst.excused ? 'text-warning' : 'text-destructive',
            )}>
              {worst.isFullDay ? worst.typeLabel : `${fmtCompact(worst.start!)}\u2013${fmtCompact(worst.end!)}`}
            </div>
          )}
        </button>
      </TooltipTrigger>

      <TooltipContent side="bottom" className="w-[248px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <div className="text-[13px] font-semibold text-slate-900">{personName}</div>
        <div className="mb-2 text-[12.5px] leading-relaxed text-slate-600">
          {dateLabel}
          {isDraft
            ? ' \u00b7 draft, not yet visible to the employee or the attendance metric.'
            : ' \u00b7 published and counted toward attendance.'}
        </div>

        <div className="space-y-1 border-t border-slate-100 pt-2">
          <InfoRow label="Shift" value={`${fmtFull(shift.start)} \u2013 ${fmtFull(shift.end)}`} />
          {ordered.map((b, i) => (
            <InfoRow
              key={i}
              label={b.kind === 'LUNCH'
                ? 'Lunch'
                : `Break ${ordered.slice(0, i + 1).filter(x => x.kind === 'BREAK').length}`}
              value={`${fmtFull(b.start)} \u2013 ${fmtFull(b.end)}`}
            />
          ))}
          <InfoRow label="Paid hours" value={fmtHours(paidMinutes(shift))} />
        </div>

        {exceptions.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
            {exceptions.map((e, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4">
                <span className={cn('text-[11px] font-semibold', e.excused ? 'text-warning' : 'text-destructive')}>
                  {e.typeLabel}
                </span>
                <span className="whitespace-nowrap text-[11px] text-slate-500">
                  {e.isFullDay ? 'Full day' : `${fmtFull(e.start!)} \u2013 ${fmtFull(e.end!)}`}
                </span>
              </div>
            ))}
            <div className="pt-0.5 text-[11px] leading-relaxed text-slate-500">
              {exceptions.every(e => e.excused)
                ? 'Excused \u2014 does not count against the employee.'
                : 'Not excused \u2014 counts against the employee.'}
            </div>
          </div>
        )}

        <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-primary">
          Click to edit this shift
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
