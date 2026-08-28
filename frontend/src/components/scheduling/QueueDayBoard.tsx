/**
 * The department's day: people down the side, quarter hours across.
 *
 * This is the spreadsheet supervisors already keep, made live. A row is one
 * person, a cell is one 15-minute slot coloured by the queue they are on, and
 * lunches and gaps are holes in the colour — which is exactly how you spot that
 * two people are away at once. Under the people, one row per queue shows the
 * headcount on it slot by slot, which is the "is anyone on Inbound at noon"
 * question the roster panel used to be asked and could not answer.
 *
 * Cells are flexed rather than absolutely positioned, unlike ActivityGantt.
 * That view draws exact runs on a percentage axis because a status can change
 * at 8:07; here every boundary is already on a quarter hour, and a run of cells
 * sharing a colour reads as one bar anyway. Flexed cells are what make each
 * slot clickable without a second hit-testing layer over the top.
 *
 * ONE popover serves the whole grid, anchored to the clicked cell. A Radix root
 * per cell would be hundreds of them for a day this size.
 */
import { useMemo, useRef, useState } from 'react'

import { Popover, PopoverAnchor } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { COVERAGE_CLS, COVERAGE_LABEL } from './scheduleTime'
import type { ApiQueueDay, ApiSlotQueueState } from '@/services/phoneQueueService'
import {
  blockAround, buildBoard, clockLabel, hourLabel, hourMarks,
  type OverrideRequest, type PersonCell, type SlotTarget,
} from './queueDayModel'
import { AWAY_CLS, COVER_STRIPES, IDLE_CLS, OFF_CLS, onCellStyle } from './queueCellStyle'
import { QueueSlotPopover } from './QueueSlotPopover'

const NAME_COL = 'w-[9.5rem] shrink-0 pr-2'
const ROW_H = 'h-6'

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" /> On a queue (its own colour)</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" style={{ backgroundImage: COVER_STRIPES }} /> Covering another queue</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 border-b-2 border-slate-900 bg-primary" /> Set by hand</span>
      <span className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5', AWAY_CLS)} /> Away</span>
      <span className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5', IDLE_CLS)} /> Not on a queue</span>
    </div>
  )
}

export function QueueDayBoard({ day, canEdit, onApply, onClear }: {
  day: ApiQueueDay
  canEdit: boolean
  onApply: (req: OverrideRequest) => void
  onClear: (req: { userId: number; start: string | null; end: string | null }) => void
}) {
  const [target, setTarget] = useState<SlotTarget | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const board = useMemo(() => buildBoard(day), [day])
  const marks = useMemo(() => hourMarks(day.slots), [day.slots])
  const colorOf = useMemo(
    () => new Map(day.queues.map(q => [q.queueId, q.color])),
    [day.queues],
  )
  // Someone out the whole day is out — no row on the coverage board. Partial PTO
  // stays, drawn as an away band on a working row.
  const people = useMemo(() => day.people.filter(p => p.shift), [day.people])

  if (day.slots.length === 0) {
    return (
      <div className="p-10 text-center text-[13px] text-slate-400">
        Nobody is scheduled on this day, so there is no queue plan to make.
      </div>
    )
  }

  const openCell = (userId: number, index: number, el: HTMLElement) => {
    const row = day.people.find(p => p.userId === userId)!
    const cells = board.get(userId)!
    const block = blockAround(cells, index)
    const rect = el.getBoundingClientRect()
    // The anchor is a zero-size box moved under the clicked cell, so one popover
    // can position itself against any of them.
    if (anchorRef.current) {
      anchorRef.current.style.left = `${rect.left}px`
      anchorRef.current.style.top = `${rect.bottom}px`
    }
    setTarget({
      userId,
      username: row.username,
      memberOf: row.memberOf,
      currentQueueId: cells[index].queueId ?? null,
      isOverridden: cells[index].reason === 'OVERRIDE',
      slotStart: day.slots[index].start,
      blockEnd: day.slots[block.to].end,
      dayEnd: day.slots[day.slots.length - 1].end,
    })
  }

  const cellTitle = (cell: PersonCell, index: number): string => {
    const when = `${clockLabel(day.slots[index].start)}`
    if (cell.kind === 'ON') {
      const name = day.queues.find(q => q.queueId === cell.queueId)?.queueName ?? 'queue'
      const how = cell.reason === 'OVERRIDE' ? 'set by hand'
        : cell.reason === 'PINNED' ? 'pinned'
          : cell.reason === 'COVER' ? 'covering' : 'home queue'
      return `${when} · ${name} (${how})`
    }
    return `${when} · ${cell.label ?? ''}`
  }

  return (
    <div className="space-y-3 p-3">
      {/* Hour ruler. Labels sit at the left edge of the slot that starts the
          hour, so they line up with the gridline rather than floating between. */}
      <div className="flex items-end">
        <div className={NAME_COL} />
        <div className="flex flex-1">
          {day.slots.map((s, i) => (
            <div key={s.startMin} className="min-w-0 flex-1">
              {marks.has(i) && (
                <span className="block text-[10px] font-semibold text-slate-500">{hourLabel(s.startMin)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-px">
        {people.map(row => {
          const cells = board.get(row.userId)!
          return (
            <div key={row.userId} className="flex items-center">
              <div className={cn(NAME_COL, 'truncate text-[13px] font-medium text-slate-700')} title={row.username}>
                {row.username}
                {row.offLabel && <span className="ml-1.5 text-[10.5px] font-normal text-slate-400">{row.offLabel}</span>}
              </div>
              <div className={cn('flex flex-1 bg-slate-50', ROW_H)}>
                {cells.map((cell, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={!canEdit || cell.kind === 'OFF'}
                    onClick={e => openCell(row.userId, i, e.currentTarget)}
                    title={cellTitle(cell, i)}
                    className={cn(
                      'min-w-0 flex-1 transition-opacity',
                      marks.has(i) && i > 0 && 'border-l border-slate-300',
                      cell.kind === 'AWAY' && AWAY_CLS,
                      cell.kind === 'IDLE' && IDLE_CLS,
                      cell.kind === 'OFF' && OFF_CLS,
                      // A cover keeps the full colour of the queue it is covering —
                      // that is how you read WHICH queue is being propped up — with
                      // diagonal lines over it to say it is a cover, not a home seat.
                      cell.kind === 'ON' && cell.reason === 'OVERRIDE' && 'border-b-2 border-slate-900',
                      canEdit && cell.kind !== 'OFF' && 'hover:opacity-75',
                    )}
                    style={cell.kind === 'ON'
                      ? onCellStyle(colorOf.get(cell.queueId!), cell.reason === 'COVER')
                      : undefined}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Headcount per queue: the answer to "is anyone on Inbound at noon". The
          number is printed only where it changes, so a flat morning reads as one
          figure instead of thirty-six. */}
      <div className="space-y-px border-t border-slate-200 pt-2">
        {day.queues.map(q => {
          const states = day.slots.map(s => s.queues.find(x => x.queueId === q.queueId))
          return (
            <div key={q.queueId} className="flex items-center">
              <div className={cn(NAME_COL, 'flex items-center gap-1.5 truncate text-[12px] text-slate-600')}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: q.color }} />
                <span className="truncate" title={q.queueName}>{q.queueName}</span>
              </div>
              <div className={cn('flex flex-1', ROW_H)}>
                {states.map((state, i) => (
                  <div
                    key={i}
                    title={state
                      ? `${clockLabel(day.slots[i].start)} · ${COVERAGE_LABEL[state.level]} — ${state.trough} on, minimum ${state.targets.min}`
                      : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center justify-center text-[9px] font-semibold tabular-nums text-slate-700',
                      marks.has(i) && i > 0 && 'border-l border-slate-300',
                      state ? COVERAGE_CLS[state.level] : 'bg-slate-100',
                    )}
                  >
                    {showCount(states, i) ? state!.trough : ''}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <Legend />

      {/* Zero-size anchor, repositioned to whichever cell was clicked. */}
      <Popover open={!!target} onOpenChange={open => { if (!open) setTarget(null) }}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="pointer-events-none fixed h-0 w-0" />
        </PopoverAnchor>
        {target && (
          <QueueSlotPopover
            key={`${target.userId}:${target.slotStart}`}
            target={target}
            queues={day.queues}
            canEdit={canEdit}
            onApply={req => { onApply(req); setTarget(null) }}
            onClear={w => {
              onClear({ userId: target.userId, start: w.start, end: w.end })
              setTarget(null)
            }}
          />
        )}
      </Popover>
    </div>
  )
}

/** Print a headcount only where it changes, so the row is readable at 36 cells. */
function showCount(states: Array<ApiSlotQueueState | undefined>, i: number): boolean {
  const s = states[i]
  if (!s || s.level === 'closed') return false
  return i === 0 || states[i - 1]?.trough !== s.trough
}
