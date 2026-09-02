/**
 * The department's week: people down the side, days across — the day board's
 * layout, one column per day instead of one per quarter hour.
 *
 * Each person-day is drawn as a single compact bar coloured by the queues they
 * were on, so a whole week reads the way the day does: you scan a row to see
 * where someone sits all week, and a column to see who is on what that day. A
 * cell is not editable here — a click opens the day, which is where a fifteen
 * minute override actually gets made. Beneath the grid a per-queue summary
 * grades each day by its thinnest moment, the same question the day board's
 * headcount rows answer.
 */
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { COVERAGE_CLS, COVERAGE_LABEL } from './scheduleTime'
import { mergeRuns, personCells } from './queueDayModel'
import { AWAY_CLS, COVER_STRIPES, IDLE_CLS, OFF_CLS, onCellStyle } from './queueCellStyle'
import { isWorkday, nonWorkdayLabel, type DayTypeMap } from './businessDays'
import type { ApiQueueWeek, ApiWeekDay } from '@/services/phoneQueueService'

const NAME_COL = 'w-[9.5rem] shrink-0 pr-2'
const ROW_H = 'h-6'

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
}

/**
 * Everyone who works at least one day this week, in the order the days first
 * name them. Someone out all week — PTO, not scheduled — is out, so they get no
 * row; a person off one day but working another still appears, blank on the day
 * they are out.
 */
function weekRoster(days: ApiWeekDay[]): Array<{ userId: number; username: string }> {
  const seen = new Set<number>()
  const out: Array<{ userId: number; username: string }> = []
  for (const d of days) {
    for (const p of d.people ?? []) {
      if (p.shift && !seen.has(p.userId)) { seen.add(p.userId); out.push({ userId: p.userId, username: p.username }) }
    }
  }
  return out
}

/** One person's whole day as a flexed bar of coloured runs, or null when they are off. */
function DayBar({ day, userId, colorOf }: {
  day: ApiWeekDay
  userId: number
  colorOf: Map<number, string>
}) {
  const row = (day.people ?? []).find(p => p.userId === userId)
  if (!day.hasSchedule || !row || !row.shift) return null
  const runs = mergeRuns(personCells(row, day.slots))
  return (
    <div className={cn('flex w-full overflow-hidden rounded bg-slate-50', ROW_H)}>
      {runs.map((run, i) => (
        <div
          key={i}
          style={run.kind === 'ON'
            ? { ...onCellStyle(colorOf.get(run.queueId!), run.reason === 'COVER'), flexGrow: run.span }
            : { flexGrow: run.span }}
          className={cn(
            'min-w-0',
            run.kind === 'AWAY' && AWAY_CLS,
            run.kind === 'IDLE' && IDLE_CLS,
            run.kind === 'OFF' && OFF_CLS,
            run.kind === 'ON' && run.reason === 'OVERRIDE' && 'border-b-2 border-slate-900',
          )}
        />
      ))}
    </div>
  )
}

export function QueueWeekBoard({ week, dayTypes, onPickDay }: {
  week: ApiQueueWeek
  /** Business-calendar day types, so non-business columns grey out like the schedule grid. */
  dayTypes?: DayTypeMap
  onPickDay: (date: string) => void
}) {
  const days = week.days
  const roster = useMemo(() => weekRoster(days), [days])
  const colorOf = useMemo(() => new Map(week.queues.map(q => [q.queueId, q.color])), [week.queues])

  if (week.notConfigured || week.queues.length === 0) {
    return (
      <div className="p-10 text-center text-[13px] text-slate-400">
        No queues are set up for this department yet.
      </div>
    )
  }
  if (roster.length === 0) {
    return (
      <div className="p-10 text-center text-[13px] text-slate-400">
        Nobody is scheduled this week, so there is no queue plan to make.
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3">
      {/* Day header: greyed and labelled for non-business days, like the schedule grid. */}
      <div className="flex items-end">
        <div className={NAME_COL} />
        {days.map(d => {
          const off = !isWorkday(dayTypes, d.date)
          const label = off ? nonWorkdayLabel(dayTypes, d.date) : null
          const clickable = d.hasSchedule && !off
          return (
            <button key={d.date} type="button" disabled={!clickable} onClick={() => onPickDay(d.date)}
              className={cn('min-w-0 flex-1 px-1 text-center text-[11px] font-semibold',
                clickable ? 'text-slate-600 hover:text-primary' : 'text-slate-300')}>
              <span className="block truncate">{dayLabel(d.date)}</span>
              {label && <span className="block truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">{label}</span>}
            </button>
          )
        })}
      </div>

      {/* People down, days across — one compact queue-coloured bar per person-day. */}
      <div className="space-y-px">
        {roster.map(person => (
          <div key={person.userId} className="flex items-center">
            <div className={cn(NAME_COL, 'truncate text-[13px] font-medium text-slate-700')} title={person.username}>
              {person.username}
            </div>
            {days.map(d => {
              const off = !isWorkday(dayTypes, d.date)
              const bar = off ? null : <DayBar day={d} userId={person.userId} colorOf={colorOf} />
              return (
                <div key={d.date} className="min-w-0 flex-1 px-0.5">
                  {bar
                    ? (
                      <button type="button" onClick={() => onPickDay(d.date)}
                        title={`Open ${dayLabel(d.date)}`}
                        className="block w-full rounded transition-shadow hover:ring-1 hover:ring-primary/40">
                        {bar}
                      </button>
                    )
                    : <div className={cn('rounded', ROW_H, off ? 'bg-slate-100' : 'bg-slate-50')} />}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Per-queue coverage summary: each day graded by its thinnest moment. */}
      <div className="space-y-px border-t border-slate-200 pt-2">
        {week.queues.map(q => (
          <div key={q.queueId} className="flex items-center">
            <div className={cn(NAME_COL, 'flex items-center gap-1.5 truncate text-[12px] text-slate-600')}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: q.color }} />
              <span className="truncate" title={q.queueName}>{q.queueName}</span>
            </div>
            {days.map(d => {
              const off = !isWorkday(dayTypes, d.date)
              const cell = (d.cells ?? []).find(c => c.queueId === q.queueId)
              if (off || !d.hasSchedule || !cell) {
                return <div key={d.date} className="min-w-0 flex-1 px-0.5"><div className={cn('rounded', ROW_H, off ? 'bg-slate-100' : 'bg-slate-50')} /></div>
              }
              return (
                <div key={d.date} className="min-w-0 flex-1 px-0.5">
                  <button type="button" onClick={() => onPickDay(d.date)}
                    title={`${dayLabel(d.date)} · ${q.queueName} — ${COVERAGE_LABEL[cell.level]}, thinnest ${cell.trough} against a minimum of ${q.targets.min}`}
                    className={cn('flex w-full items-center justify-center rounded text-[10px] font-semibold tabular-nums text-slate-700 transition-shadow hover:ring-1 hover:ring-primary/40',
                      ROW_H, COVERAGE_CLS[cell.level])}>
                    {cell.trough}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" /> On a queue (its own colour)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" style={{ backgroundImage: COVER_STRIPES }} /> Covering another queue</span>
        <span className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5', AWAY_CLS)} /> Away</span>
        <span>Click any day to open it.</span>
      </div>
    </div>
  )
}
