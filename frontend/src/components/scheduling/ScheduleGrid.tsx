/**
 * MOCKUP — Phase 1 design probe only. Static props, no data fetching.
 *
 * People down, days across. Serves two views off one component:
 *   'week'   — 7 columns at 150px, the surface for building and editing
 *   'period' — 14 columns at 92px, the pay-period overview
 *
 * The name column is sticky so horizontal scroll never loses context, and
 * people are grouped by department including an Unassigned group for users
 * with no department_id, who sit outside every manager's scope and would
 * otherwise vanish from the list entirely.
 */
import { Fragment } from 'react'
import { AlertTriangle, CalendarOff } from 'lucide-react'
import { Table, TableBody, TableHeader } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { ScheduleDayCell } from './ScheduleDayCell'
import { DeptCoverageRow } from './DeptCoverageRow'
import type { CoverageSettings } from './ScheduleDayTimeline'
import {
  addDays, isWeekend, MOCK_HOLIDAYS, parseLocal, toLocalIso,
  type MockPerson,
} from './mockScheduleData'
import { axisTicks, buildDayAxis, hourLabel, pctOf } from './scheduleTime'

const UNASSIGNED = 'Unassigned'
/** Its own ruled column, not a checkbox floating on the name line. */
const SEL_COL = 'w-11 min-w-[44px] max-w-[44px] border-r border-slate-200'
const NAME_COL = 'w-[186px] min-w-[186px]'
const NAME_LEFT = 'left-[44px]'

function weekLabel(iso: string): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(parseLocal(iso))} \u2013 ${fmt(parseLocal(addDays(iso, 6)))}`
}

interface GridProps {
  people: MockPerson[]
  weekStarts: string[]
  variant: 'week' | 'period'
  onEditShift?: (personId: number, date: string) => void
  selected: Set<number>
  /** Sets the selected state for a group of people at once. */
  onSelect: (ids: number[], next: boolean) => void
  /** Live per-department green/yellow minimums from Coverage settings. */
  coverage?: CoverageSettings
}

export function ScheduleGrid({
  people, weekStarts, variant, onEditShift, selected, onSelect, coverage,
}: GridProps) {
  const today = toLocalIso(new Date())
  const days = weekStarts.flatMap(ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i)))
  const isWeek = variant === 'week'
  const colW = isWeek ? 'min-w-[150px]' : 'min-w-[92px]'

  /** One axis for the whole week so bars are comparable across columns. */
  const axis = isWeek
    ? buildDayAxis(people.flatMap(p => p.shifts.filter(s => days.includes(s.date))))
    : undefined
  const ticks = axis ? axisTicks(axis) : []

  const groups = [...new Set(people.map(p => p.department ?? UNASSIGNED))].map(dept => ({
    dept,
    members: people.filter(p => (p.department ?? UNASSIGNED) === dept),
  }))
  const allIds = people.map(p => p.id)

  const weekState = (ws: string) => {
    const inWeek = people.flatMap(p => p.shifts.filter(s => s.date >= ws && s.date <= addDays(ws, 6)))
    if (inWeek.length === 0) return 'empty' as const
    return inWeek.some(s => s.status === 'DRAFT') ? ('draft' as const) : ('published' as const)
  }

  return (
    <Table className="border-separate border-spacing-0">
      <TableHeader>
        {/* Week band — publish is a per-week act, so it lives here. */}
        <tr>
          <th className={cn(SEL_COL, 'sticky left-0 z-20 border-b border-slate-200 bg-white')} />
          <th className={cn(NAME_COL, NAME_LEFT, 'sticky z-20 border-b border-r border-slate-200 bg-white')} />
          {weekStarts.map(ws => {
            const state = weekState(ws)
            const stale = state === 'draft' && ws <= today
            return (
              <th
                key={ws}
                colSpan={7}
                className={cn(
                  'border-b border-r border-slate-200 px-3 py-2 text-left',
                  stale ? 'bg-warning/10' : 'bg-slate-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-slate-700">{weekLabel(ws)}</span>
                  {state === 'draft' && (
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      stale ? 'bg-warning/20 text-warning' : 'bg-slate-200 text-slate-600',
                    )}>
                      {stale && <AlertTriangle className="h-3 w-3" />}
                      {stale ? 'Draft \u00b7 week already started' : 'Draft'}
                    </span>
                  )}
                  {state === 'published' && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Published
                    </span>
                  )}
                  {axis && (
                    <span className="ml-auto text-[10px] text-slate-400">
                      bars scaled {hourLabel(axis.startMin)}&ndash;{hourLabel(axis.endMin)}
                    </span>
                  )}
                  {state === 'draft' && (
                    <Button size="sm" variant="primary" className={cn('h-6 px-2 text-[11px]', !axis && 'ml-auto')}>
                      Publish week
                    </Button>
                  )}
                </div>
              </th>
            )
          })}
        </tr>

        <tr>
          <th className={cn(SEL_COL, 'sticky left-0 z-20 border-b border-slate-200 bg-white px-0 py-2 text-center align-middle')}>
            <Checkbox
              checked={allIds.length > 0 && allIds.every(id => selected.has(id))}
              onCheckedChange={v => onSelect(allIds, v === true)}
              aria-label="Select all employees"
            />
          </th>
          <th className={cn(NAME_COL, NAME_LEFT, 'sticky z-20 border-b border-r border-slate-200 bg-white py-2 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-slate-400')}>
            Employee
          </th>
          {days.map(iso => {
            const d = parseLocal(iso)
            const isToday = iso === today
            return (
              <th
                key={iso}
                className={cn(
                  'border-b border-slate-200 px-1 py-1.5 text-center',
                  colW,
                  isWeekend(iso) && 'bg-slate-50',
                  isToday && 'bg-primary/10',
                  iso === addDays(weekStarts[0], 6) && weekStarts.length > 1 && 'border-r border-r-slate-200',
                )}
              >
                <div className={cn(
                  'text-[10px] font-medium uppercase tracking-wide',
                  isToday ? 'text-primary' : 'text-slate-400',
                )}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div className={cn('text-[13px] font-semibold', isToday ? 'text-primary' : 'text-slate-700')}>
                  {d.getDate()}
                </div>

                {/* Per-column hour ruler — the week cannot share one axis across
                    the table, so each day carries its own copy of the scale. */}
                {axis && !isWeekend(iso) && (
                  <div className="relative mx-1.5 mt-1 h-3 border-t border-slate-200">
                    {ticks.map(m => (
                      <span
                        key={m}
                        className="absolute top-0 -translate-x-1/2 text-[9px] font-normal leading-3 text-slate-300"
                        style={{ left: `${pctOf(m, axis)}%` }}
                      >
                        {hourLabel(m)}
                      </span>
                    ))}
                  </div>
                )}
              </th>
            )
          })}
        </tr>
      </TableHeader>

      <TableBody>
        {groups.map(({ dept, members }) => (
          <Fragment key={dept}>
            <tr className={dept === UNASSIGNED ? 'bg-warning/15' : 'bg-slate-200/70'}>
              <td className={cn(
                SEL_COL,
                'sticky left-0 border-b border-slate-200 py-1.5 text-center align-middle',
                dept === UNASSIGNED ? 'bg-warning/15' : 'bg-slate-200/70',
              )}>
                <Checkbox
                  checked={members.every(m => selected.has(m.id))}
                  onCheckedChange={v => onSelect(members.map(m => m.id), v === true)}
                  aria-label={`Select everyone in ${dept}`}
                />
              </td>
              <td
                colSpan={days.length + 1}
                className={cn(
                  'border-b border-slate-200 px-3 py-1.5 align-middle text-[11px] font-semibold uppercase tracking-wide',
                  dept === UNASSIGNED ? 'text-warning' : 'text-slate-700',
                )}
              >
                {dept}
                {dept === UNASSIGNED && (
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
                    no department set &mdash; visible to admins only
                  </span>
                )}
              </td>
            </tr>

            {members.map(person => {
              const scheduled = person.shifts.some(s => days.includes(s.date))
              return (
                <tr key={person.id} className="group">
                  <td className={cn(
                    SEL_COL,
                    'sticky left-0 z-10 border-b border-slate-200 py-1.5 text-center align-middle',
                    selected.has(person.id) ? 'bg-primary/[0.06]' : 'bg-white group-hover:bg-slate-50',
                  )}>
                    <Checkbox
                      className="mx-auto"
                      checked={selected.has(person.id)}
                      onCheckedChange={v => onSelect([person.id], v === true)}
                      aria-label={`Select ${person.name}`}
                    />
                  </td>
                  <td className={cn(
                    NAME_COL,
                    NAME_LEFT,
                    'sticky z-10 border-b border-r border-slate-200 px-3 py-1.5 align-middle',
                    selected.has(person.id) ? 'bg-primary/[0.06]' : 'bg-white group-hover:bg-slate-50',
                  )}>
                    <div className="truncate text-[13px] font-medium text-slate-700">{person.name}</div>
                    {!scheduled && (
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-warning">
                        <CalendarOff className="h-3 w-3" /> Not scheduled
                      </div>
                    )}
                  </td>

                  {days.map(iso => (
                    <td
                      key={iso}
                      className={cn(
                        'border-b border-slate-100 p-0 align-top',
                        iso === addDays(weekStarts[0], 6) && weekStarts.length > 1 && 'border-r border-r-slate-200',
                      )}
                    >
                      <ScheduleDayCell
                        variant={variant}
                        axis={axis}
                        personName={person.name}
                        dateLabel={parseLocal(iso).toLocaleDateString('en-US', {
                          weekday: 'long', month: 'long', day: 'numeric',
                        })}
                        shift={person.shifts.find(s => s.date === iso)}
                        exceptions={person.exceptions.filter(e => e.date === iso)}
                        isWeekend={isWeekend(iso)}
                        holidayName={MOCK_HOLIDAYS[iso]}
                        onClick={() => onEditShift?.(person.id, iso)}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}

            {/* Coverage heat row — only when the department has coverage turned
                on (Scheduling > Coverage Thresholds) and has more than one
                person, mirroring the day view's strip gating. */}
            {(() => {
              const cov = coverage?.get(dept)
              if (!cov?.enabled || members.length <= 1) return null
              return (
                <DeptCoverageRow
                  dept={dept}
                  members={members}
                  days={days}
                  weekStarts={weekStarts}
                  windows={cov.windows}
                  selCol={SEL_COL}
                  nameCol={NAME_COL}
                  nameLeft={NAME_LEFT}
                />
              )
            })()}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}
