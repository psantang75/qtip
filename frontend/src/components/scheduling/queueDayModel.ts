/**
 * Turning a solved day into the cells the grid draws.
 *
 * Pure, and separate from the board component, because "what is this person
 * doing at 12:30" is the part with rules in it — shift bounds, lunch, PTO,
 * placed, spare — and the board should only have to colour the answer.
 */
import type { ApiPersonDayRow, ApiQueueDay, ApiSlotSolution, SeatReason } from '@/services/phoneQueueService'

export type CellKind =
  /** Outside their shift, or not working at all. */
  | 'OFF'
  /** On shift but not reachable: lunch, a break, a PTO window. */
  | 'AWAY'
  /** Available and placed on a queue. */
  | 'ON'
  /** Available, but the solver had nowhere to put them. */
  | 'IDLE'

export interface PersonCell {
  kind: CellKind
  /** Set when kind is 'ON'. */
  queueId?: number
  reason?: SeatReason
  /** 'Lunch', 'PTO', 'Not scheduled' — whatever the cell needs to explain itself. */
  label?: string
}

const minutesOf = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** One cell per slot for one person. */
export function personCells(row: ApiPersonDayRow, slots: ApiSlotSolution[]): PersonCell[] {
  if (!row.shift) return slots.map(() => ({ kind: 'OFF', label: row.offLabel ?? 'Not scheduled' }))

  const shiftStart = minutesOf(row.shift.start)
  const shiftEnd = minutesOf(row.shift.end)
  const bands = row.away.map(b => ({ ...b, startMin: minutesOf(b.start), endMin: minutesOf(b.end) }))

  return slots.map(slot => {
    if (slot.startMin < shiftStart || slot.startMin >= shiftEnd) {
      return { kind: 'OFF', label: 'Off shift' }
    }
    const band = bands.find(b => slot.startMin >= b.startMin && slot.startMin < b.endMin)
    if (band) return { kind: 'AWAY', label: band.label }

    const seat = slot.assignments.find(a => a.userId === row.userId)
    if (seat) return { kind: 'ON', queueId: seat.queueId, reason: seat.reason }
    return { kind: 'IDLE', label: 'Not on a queue' }
  })
}

export function buildBoard(day: ApiQueueDay): Map<number, PersonCell[]> {
  return new Map(day.people.map(row => [row.userId, personCells(row, day.slots)]))
}

/** A contiguous run of identical cells, for drawing one person-day as a compact bar. */
export interface CellRun {
  kind: CellKind
  queueId?: number
  reason?: SeatReason
  /** How many slots this run spans, so the bar can flex proportionally. */
  span: number
}

/**
 * Collapse per-slot cells into runs of the same state. The week grid draws a
 * whole day in one narrow cell, where thirty-six clickable slots would be both
 * illegible and needless — a click there opens the day, it does not edit a slot.
 */
export function mergeRuns(cells: PersonCell[]): CellRun[] {
  const runs: CellRun[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.kind === c.kind && last.queueId === c.queueId && last.reason === c.reason) last.span++
    else runs.push({ kind: c.kind, queueId: c.queueId, reason: c.reason, span: 1 })
  }
  return runs
}

/**
 * The run of slots around `index` that share its state — the contiguous block a
 * click should default to overriding.
 *
 * Clicking anywhere in an hour of lunch cover should offer to change the whole
 * hour, because that is the decision being made. Four separate quarter-hour
 * edits is the same decision typed four times.
 */
export function blockAround(cells: PersonCell[], index: number): { from: number; to: number } {
  const same = (a: PersonCell, b: PersonCell) => a.kind === b.kind && a.queueId === b.queueId
  const anchor = cells[index]
  let from = index
  let to = index
  while (from > 0 && same(cells[from - 1], anchor)) from--
  while (to < cells.length - 1 && same(cells[to + 1], anchor)) to++
  return { from, to }
}

/** Whole-hour boundaries on the axis, as slot indexes. */
export function hourMarks(slots: ApiSlotSolution[]): Set<number> {
  const out = new Set<number>()
  slots.forEach((s, i) => { if (s.startMin % 60 === 0) out.add(i) })
  return out
}

/** '08:00' -> '8a', matching the scheduling views' compact axis labels. */
export function hourLabel(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'p' : 'a'}`
}

/** '08:00' -> '8:00 AM'. For popover headers, where there is room to be exact. */
export function clockLabel(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

// ── Overriding a cell ────────────────────────────────────────────────────────

export interface SlotTarget {
  userId: number
  username: string
  /** Queues this person may be placed on at all. */
  memberOf: number[]
  /** The queue they are on in the clicked slot, when any. */
  currentQueueId: number | null
  /** True when that placement is already a manual one. */
  isOverridden: boolean
  /** Where the adjustment begins — the start of the clicked slot. */
  slotStart: string
  /** End of the contiguous run under the cursor, which seeds the default length. */
  blockEnd: string
  /** End of the day's axis: an adjustment cannot run past it. */
  dayEnd: string
}

export interface OverrideRequest {
  userId: number
  queueId: number
  action: 'ASSIGN' | 'EXCLUDE'
  /** Null for the whole day. */
  start: string | null
  end: string | null
}

/** How long an adjustment runs: a number of minutes, or the whole day. */
export type DurationChoice = number | 'DAY'

const hmOf = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

/**
 * The window a duration choice resolves to: it starts at the clicked slot and
 * runs for the chosen length, capped at the end of the day. 'DAY' is null/null,
 * which the API reads as all day. "Back to automatic" is handed this same
 * window, so clearing only frees the stretch the user actually chose.
 */
export function windowForDuration(target: SlotTarget, choice: DurationChoice): { start: string | null; end: string | null } {
  if (choice === 'DAY') return { start: null, end: null }
  const start = minutesOf(target.slotStart)
  const end = Math.min(start + choice, minutesOf(target.dayEnd))
  return { start: target.slotStart, end: hmOf(end) }
}

/** Every 15-minute length from the clicked slot to the end of the day. */
export function durationOptions(target: SlotTarget): number[] {
  const span = minutesOf(target.dayEnd) - minutesOf(target.slotStart)
  const out: number[] = []
  for (let m = 15; m <= span; m += 15) out.push(m)
  return out.length ? out : [15]
}

/** The starting length: the contiguous block under the cursor. */
export function defaultDuration(target: SlotTarget): number {
  return Math.max(15, minutesOf(target.blockEnd) - minutesOf(target.slotStart))
}

/** 90 → '1 hr 30 min', 60 → '1 hr', 15 → '15 min'. */
export function durationLabel(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}
