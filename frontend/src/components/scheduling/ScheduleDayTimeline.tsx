/**
 * MOCKUP — Phase 1 design probe only. Static props, no data fetching.
 *
 * Day view: one day on a shared hour axis, people down the side. This is the
 * view that answers "is anyone covering the phones at noon" — individual
 * schedules can each look fine while collectively leaving a hole, and that is
 * only visible when every shift is drawn against the same time axis.
 *
 * The coverage strip along the bottom is the summary of that: a trough in the
 * blue band is a coverage hole no matter how reasonable each row looks.
 */
import { Fragment } from 'react'
import { CalendarOff } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { MockPerson, MockShift } from './mockScheduleData'
import { toLocalIso } from './mockScheduleData'
import { DeptCoverageStrip } from './DeptCoverageStrip'
import {
  buildDayAxis, fmtCompact, hhmmOf, hourLabel, minutesOf, pctOf, SEGMENT_CLS, shiftSegments,
} from './scheduleTime'

const UNASSIGNED = 'Unassigned'
/** Its own ruled column, not a checkbox floating on the name line. */
const SEL_COL = 'w-11 min-w-[44px] border-r border-slate-200'
const NAME_COL = 'w-[186px] min-w-[186px]'

interface Props {
  people: MockPerson[]
  date: string
  onEditShift?: (personId: number, date: string) => void
  selected: Set<number>
  onSelect: (ids: number[], next: boolean) => void
}

export function ScheduleDayTimeline({ people, date, onEditShift, selected, onSelect }: Props) {
  const allIds = people.map(p => p.id)
  const dayShifts = people
    .map(p => p.shifts.find(s => s.date === date))
    .filter((s): s is MockShift => !!s)

  const axis = buildDayAxis(dayShifts)

  const groups = [...new Set(people.map(p => p.department ?? UNASSIGNED))].map(dept => ({
    dept,
    members: people.filter(p => (p.department ?? UNASSIGNED) === dept),
  }))

  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const showNow = date === toLocalIso(now) && nowMins >= axis.startMin && nowMins <= axis.endMin

  const Gridlines = () => (
    <div className="pointer-events-none absolute inset-0">
      {axis.hours.map(m => (
        <div
          key={m}
          className="absolute inset-y-0 w-px bg-slate-100"
          style={{ left: `${pctOf(m, axis)}%` }}
        />
      ))}
      {showNow && (
        <div
          className="absolute inset-y-0 w-px bg-primary/70"
          style={{ left: `${pctOf(nowMins, axis)}%` }}
        />
      )}
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        {/* Hour axis */}
        <div className="flex items-end border-b border-slate-200 bg-slate-50">
          <div className={cn(SEL_COL, 'flex items-center justify-center py-2')}>
            <Checkbox
              checked={allIds.length > 0 && allIds.every(id => selected.has(id))}
              onCheckedChange={v => onSelect(allIds, v === true)}
              aria-label="Select all employees"
            />
          </div>
          <div className={cn(NAME_COL, 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400')}>
            Employee
          </div>
          <div className="relative h-9 flex-1">
            {axis.hours.map(m => (
              <div
                key={m}
                className="absolute bottom-1 -translate-x-1/2 text-[10px] font-medium text-slate-400"
                style={{ left: `${pctOf(m, axis)}%` }}
              >
                {hourLabel(m)}
              </div>
            ))}
          </div>
        </div>

        {groups.map(({ dept, members }) => (
          <Fragment key={dept}>
            <div
              className={cn(
                'flex items-center border-b border-slate-200 py-1.5 text-[11px] font-semibold uppercase tracking-wide',
                dept === UNASSIGNED ? 'bg-warning/15 text-warning' : 'bg-slate-200/70 text-slate-700',
              )}
            >
              <span className={cn(SEL_COL, 'flex justify-center')}>
                <Checkbox
                  checked={members.every(m => selected.has(m.id))}
                  onCheckedChange={v => onSelect(members.map(m => m.id), v === true)}
                  aria-label={`Select everyone in ${dept}`}
                />
              </span>
              {dept}
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                {members.filter(m => m.shifts.some(s => s.date === date)).length} of{' '}
                {members.length} scheduled
              </span>
            </div>

            {members.map(person => {
              const shift = person.shifts.find(s => s.date === date)
              const exceptions = person.exceptions.filter(e => e.date === date)
              const fullDay = exceptions.find(e => e.isFullDay)

              return (
                <div className={cn(
                  'flex items-stretch border-b border-slate-100',
                  selected.has(person.id) ? 'bg-primary/[0.06]' : 'hover:bg-slate-50/60',
                )} key={person.id}>
                  <div className={cn(SEL_COL, 'flex justify-center pt-2.5')}>
                    <Checkbox
                      checked={selected.has(person.id)}
                      onCheckedChange={v => onSelect([person.id], v === true)}
                      aria-label={`Select ${person.name}`}
                    />
                  </div>
                  <div className={cn(NAME_COL, 'min-w-0 border-r border-slate-200 px-3 py-2')}>
                    <div className="truncate text-[13px] font-medium text-slate-700">{person.name}</div>
                    {!shift && (
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-warning">
                        <CalendarOff className="h-3 w-3" /> Not scheduled
                      </div>
                    )}
                  </div>

                  <div className="relative min-h-[42px] flex-1">
                    <Gridlines />

                    {shift && (
                      <button
                        type="button"
                        onClick={() => onEditShift?.(person.id, date)}
                        className={cn(
                          'absolute top-1/2 h-7 -translate-y-1/2 overflow-hidden rounded-md border text-left transition-shadow hover:shadow-md',
                          shift.status === 'DRAFT'
                            ? 'border-dashed border-slate-300 bg-slate-100'
                            : 'border-primary/40 bg-primary/15',
                        )}
                        style={{
                          left: `${pctOf(minutesOf(shift.start), axis)}%`,
                          width: `${pctOf(minutesOf(shift.end), axis) - pctOf(minutesOf(shift.start), axis)}%`,
                        }}
                      >
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-600">
                          {fmtCompact(shift.start)}
                        </span>
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-600">
                          {fmtCompact(shift.end)}
                        </span>

                        {/* Breaks, then exceptions painted over them — every
                            carve-out of the shift in one language. */}
                        {shiftSegments(shift, exceptions).map((seg, i) => {
                          const shiftL = pctOf(minutesOf(shift.start), axis)
                          const shiftW = pctOf(minutesOf(shift.end), axis) - shiftL
                          const l = pctOf(seg.startMin, axis)
                          const w = pctOf(seg.endMin, axis) - l
                          const isException = seg.kind === 'EXCUSED' || seg.kind === 'UNEXCUSED'
                          return (
                            <span
                              key={i}
                              title={`${seg.label} \u00b7 ${fmtCompact(hhmmOf(seg.startMin))}\u2013${fmtCompact(hhmmOf(seg.endMin))}`}
                              className={cn(
                                'absolute inset-y-0 flex items-center justify-center overflow-hidden',
                                SEGMENT_CLS[seg.kind],
                              )}
                              style={{
                                left: `${((l - shiftL) / shiftW) * 100}%`,
                                width: `${(w / shiftW) * 100}%`,
                              }}
                            >
                              <span className="truncate px-1 text-[9px] font-bold uppercase text-white">
                                {isException ? seg.label : seg.kind === 'LUNCH' ? 'L' : ''}
                              </span>
                            </span>
                          )
                        })}
                      </button>
                    )}

                    {!shift && fullDay && (
                      <span
                        className={cn(
                          'absolute left-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          fullDay.excused
                            ? 'bg-warning/20 text-warning'
                            : 'bg-destructive/15 text-destructive',
                        )}
                      >
                        {fullDay.typeLabel}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* A one-person department has no coverage question — the strip
                would just restate the row above it. */}
            {members.length > 1 && (
              <DeptCoverageStrip
                dept={dept}
                members={members}
                date={date}
                axis={axis}
                selCol={SEL_COL}
                nameCol={NAME_COL}
                gridlines={<Gridlines />}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
