/**
 * MOCKUP — Phase 1 design probe only.
 *
 * Wall-clock time helpers shared by the day, week and period views. Everything
 * here works on 'HH:MM' strings and integer minutes, never Date objects, so
 * nothing can drift across a DST boundary.
 */
import type {
  CoverageThreshold, MockBreak, MockException, MockPerson, MockShift, TemplateDay,
} from './mockScheduleData'

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function hhmmOf(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** '08:00' -> '8a', '10:30' -> '10:30a'. For tight grid cells. */
export function fmtCompact(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'p' : 'a'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`
}

/** '08:00' -> '8:00 AM'. For tooltips and editors. */
export function fmtFull(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/** 480 -> '8a'. Axis ticks and scale legends. */
export function hourLabel(mins: number): string {
  const h = Math.floor(mins / 60)
  const suffix = h >= 12 ? 'p' : 'a'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${suffix}`
}

export function durationMins(b: MockBreak): number {
  return minutesOf(b.end) - minutesOf(b.start)
}

/** Gross span minus unpaid lunch. */
/** Lunch is unpaid; breaks are not. Shared by shifts and template days, which
 *  carry the same start/end/breaks shape. */
export function paidMinutes(block: { start: string; end: string; breaks: MockBreak[] }): number {
  const gross = minutesOf(block.end) - minutesOf(block.start)
  const unpaid = block.breaks
    .filter(b => b.kind === 'LUNCH')
    .reduce((sum, b) => sum + durationMins(b), 0)
  return Math.max(0, gross - unpaid)
}

export function templateDayPaid(d: TemplateDay): number {
  return d.working ? paidMinutes(d) : 0
}

export function fmtHours(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ── Shift segments ───────────────────────────────────────────────────────────

export type SegmentKind = 'BREAK' | 'LUNCH' | 'EXCUSED' | 'UNEXCUSED'

export interface ShiftSegment {
  kind: SegmentKind
  startMin: number
  endMin: number
  label: string
}

/**
 * Colour language, escalating from planned to unplanned:
 *   blue   (the bar itself) — scheduled and working
 *   slate  — scheduled away: break and lunch
 *   amber  — excused deviation, forgiven
 *   red    — unexcused deviation, counts against the employee
 *
 * Breaks are deliberately neutral rather than amber so that exceptions, which
 * are the thing a manager needs to spot, are the only warm colour on screen.
 */
export const SEGMENT_CLS: Record<SegmentKind, string> = {
  BREAK: 'bg-slate-300',
  LUNCH: 'bg-slate-400',
  EXCUSED: 'bg-warning',
  UNEXCUSED: 'bg-destructive',
}

/**
 * Everything that carves into a shift, clipped to the shift bounds and ordered
 * so exceptions paint over breaks — an excused window that swallows a break is
 * still excused time, not break time.
 */
export function shiftSegments(shift: MockShift, exceptions: MockException[]): ShiftSegment[] {
  const shiftStart = minutesOf(shift.start)
  const shiftEnd = minutesOf(shift.end)

  const segments: ShiftSegment[] = shift.breaks.map(b => ({
    kind: b.kind,
    startMin: minutesOf(b.start),
    endMin: minutesOf(b.end),
    label: b.kind === 'LUNCH' ? 'Lunch' : 'Break',
  }))

  for (const ex of exceptions) {
    const from = ex.isFullDay ? shiftStart : Math.max(shiftStart, minutesOf(ex.start!))
    const to = ex.isFullDay ? shiftEnd : Math.min(shiftEnd, minutesOf(ex.end!))
    if (to <= from) continue
    segments.push({
      kind: ex.excused ? 'EXCUSED' : 'UNEXCUSED',
      startMin: from,
      endMin: to,
      label: ex.typeLabel,
    })
  }

  return segments
}

/** True when the minute falls inside an exception window on this shift. */
function inException(mins: number, exceptions: MockException[], shift: MockShift): boolean {
  return exceptions.some(ex => {
    if (ex.isFullDay) return true
    const from = Math.max(minutesOf(shift.start), minutesOf(ex.start!))
    const to = Math.min(minutesOf(shift.end), minutesOf(ex.end!))
    return mins >= from && mins < to
  })
}

// ── Day-view axis + coverage ─────────────────────────────────────────────────

export interface DayAxis {
  /** Whole-hour bounds covering every shift on screen. */
  startMin: number
  endMin: number
  hours: number[]
}

const DEFAULT_AXIS: DayAxis = { startMin: 7 * 60, endMin: 19 * 60, hours: [] }

/** Axis spanning every shift shown, padded out to whole hours. */
export function buildDayAxis(shifts: MockShift[]): DayAxis {
  if (shifts.length === 0) {
    return { ...DEFAULT_AXIS, hours: hourMarks(DEFAULT_AXIS.startMin, DEFAULT_AXIS.endMin) }
  }
  const min = Math.min(...shifts.map(s => minutesOf(s.start)))
  const max = Math.max(...shifts.map(s => minutesOf(s.end)))
  const startMin = Math.floor(min / 60) * 60
  const endMin = Math.ceil(max / 60) * 60
  return { startMin, endMin, hours: hourMarks(startMin, endMin) }
}

function hourMarks(startMin: number, endMin: number): number[] {
  const out: number[] = []
  for (let m = startMin; m <= endMin; m += 60) out.push(m)
  return out
}

/**
 * A few labelled hours for the week view's per-column ruler. A 150px column
 * cannot carry an hourly tick, so this thins the axis to whole hours that
 * divide evenly and still land inside the range.
 */
export function axisTicks(axis: DayAxis, maxTicks = 4): number[] {
  const spanHours = (axis.endMin - axis.startMin) / 60
  const step = Math.max(2, Math.ceil(spanHours / maxTicks))
  const out: number[] = []
  for (let m = axis.startMin; m <= axis.endMin; m += step * 60) out.push(m)
  return out
}

/** Percentage offset of a wall-clock minute along the axis. */
export function pctOf(mins: number, axis: DayAxis): number {
  const span = axis.endMin - axis.startMin
  if (span <= 0) return 0
  return ((mins - axis.startMin) / span) * 100
}

export interface CoverageSlot {
  startMin: number
  /** Scheduled, and neither on a break nor inside an exception window. */
  working: number
  /** On a break or lunch right now. */
  onBreak: number
  /** Away on an exception — excused or not, they are still not on the phones. */
  onException: number
}

/**
 * Headcount per slot across the day. This is what makes stacked lunches
 * obvious: a trough in `working` is a coverage hole, regardless of whether
 * any individual schedule looks reasonable on its own.
 *
 * Exceptions count as away. An excused late arrival is forgiven for the
 * employee but the desk is still empty, and the whole point of this strip is
 * to show the effect on the team rather than the effect on the person.
 */
export function buildCoverage(
  people: MockPerson[],
  date: string,
  axis: DayAxis,
  slotMins = 15,
): CoverageSlot[] {
  const rows = people
    .map(p => ({
      shift: p.shifts.find(s => s.date === date),
      exceptions: p.exceptions.filter(e => e.date === date),
    }))
    .filter((r): r is { shift: MockShift; exceptions: MockException[] } => !!r.shift)

  const slots: CoverageSlot[] = []
  for (let m = axis.startMin; m < axis.endMin; m += slotMins) {
    let working = 0
    let onBreak = 0
    let onException = 0
    for (const { shift, exceptions } of rows) {
      if (m < minutesOf(shift.start) || m >= minutesOf(shift.end)) continue
      if (inException(m, exceptions, shift)) onException++
      else if (shift.breaks.some(b => m >= minutesOf(b.start) && m < minutesOf(b.end))) onBreak++
      else working++
    }
    slots.push({ startMin: m, working, onBreak, onException })
  }
  return slots
}

/** Worst simultaneous absence — break or exception — for a department. */
export function peakAway(slots: CoverageSlot[]): number {
  return slots.reduce((max, s) => Math.max(max, s.onBreak + s.onException), 0)
}

/**
 * Fewest people working at any *monitored* moment — a slot inside a coverage
 * window and with someone scheduled. Unmonitored minutes (before open, after
 * the evening drop, or any gap between windows) are excluded, so a shift that
 * runs past the last window no longer drags the low down.
 */
export function troughWorking(slots: CoverageSlot[], windows: CoverageWindow[]): number {
  const monitored = slots.filter(
    s => windowAt(s.startMin, windows) && s.working + s.onBreak + s.onException > 0,
  )
  if (!monitored.length) return 0
  return monitored.reduce((min, s) => Math.min(min, s.working), Infinity)
}

export type CoverageLevel = 'none' | 'red' | 'yellow' | 'green' | 'closed'

export function coverageLevel(
  working: number,
  scheduled: number,
  t: CoverageThreshold,
): CoverageLevel {
  if (scheduled === 0) return 'closed'
  if (working === 0) return 'none'
  if (working >= t.green) return 'green'
  if (working >= t.yellow) return 'yellow'
  return 'red'
}

// ── Time-of-day coverage windows ─────────────────────────────────────────────

/**
 * One staffing bar for a slice of the day. Staffing is not flat: a call centre
 * needs nobody at 7am, its full bar from open, and a thinner bar after the
 * evening drop. Each window carries its own green/yellow, and the minutes
 * outside every window are unmonitored — the fix for the phantom red at the
 * open and close of every day.
 */
export interface CoverageWindow {
  startMin: number
  endMin: number
  green: number
  yellow: number
}

/** The window governing a wall-clock minute, or null when unmonitored. */
export function windowAt(mins: number, windows: CoverageWindow[]): CoverageWindow | null {
  for (const w of windows) if (mins >= w.startMin && mins < w.endMin) return w
  return null
}

/** Grade a single slot against the window it falls in. Unmonitored or unstaffed
 *  slots read 'closed' — grey, and never a warning. */
export function slotLevel(slot: CoverageSlot, windows: CoverageWindow[]): CoverageLevel {
  const w = windowAt(slot.startMin, windows)
  if (!w) return 'closed'
  const scheduled = slot.working + slot.onBreak + slot.onException
  if (scheduled === 0) return 'closed'
  return coverageLevel(slot.working, scheduled, w)
}

/** Escalation order, so "the worst thing that happened today" is comparable. */
export const COVERAGE_SEVERITY: Record<CoverageLevel, number> = {
  closed: 0, green: 1, yellow: 2, red: 3, none: 4,
}

/** The most severe grade across a set of slots — the day's headline status. */
export function worstCoverageLevel(slots: CoverageSlot[], windows: CoverageWindow[]): CoverageLevel {
  let level: CoverageLevel = 'closed'
  let sev = -1
  for (const s of slots) {
    const lvl = slotLevel(s, windows)
    if (COVERAGE_SEVERITY[lvl] > sev) { sev = COVERAGE_SEVERITY[lvl]; level = lvl }
  }
  return level
}

/** Heat map fill, kept muted — this is a background signal you scan, not a
 *  status you read. 'none' is the one that gets to shout, because nobody at all
 *  is a different problem from being thin. */
export const COVERAGE_CLS: Record<CoverageLevel, string> = {
  closed: 'bg-slate-200',
  none: 'bg-destructive/70',
  red: 'bg-destructive/35',
  yellow: 'bg-warning/45',
  green: 'bg-success/40',
}

/**
 * Publish state of a date range, which decides whether bulk writes are offered
 * at all. Rebuilding a week wholesale is only safe while it is still a draft;
 * once posted, changing it is a deliberate per-shift act, not a bulk one.
 */
export type RangeStatus = 'empty' | 'draft' | 'mixed' | 'published' | 'locked'

export function rangeStatus(
  people: MockPerson[],
  dates: string[],
  today: string,
): RangeStatus {
  const set = new Set(dates)
  const shifts = people.flatMap(p => p.shifts.filter(s => set.has(s.date)))
  if (!shifts.length) return 'empty'

  const drafts = shifts.filter(s => s.status === 'DRAFT').length
  if (drafts === shifts.length) return 'draft'
  if (drafts > 0) return 'mixed'
  return dates[dates.length - 1] <= today ? 'locked' : 'published'
}

/**
 * Exceptions on one day may not overlap. Two excused windows covering the same
 * hour would let the attendance engine forgive it twice, and a full day plus
 * anything else is the same fault stated less obviously — a full day already
 * covers every hour there is.
 *
 * Returns the exception the candidate collides with, or null when it is clear.
 * Pure so the server can enforce the identical rule against the same tests;
 * the UI blocking the save is a courtesy, not the control.
 */
export function findExceptionOverlap(
  existing: MockException[],
  candidate: { isFullDay: boolean; start?: string; end?: string },
): MockException | null {
  for (const ex of existing) {
    if (ex.isFullDay || candidate.isFullDay) return ex
    if (minutesOf(candidate.start!) < minutesOf(ex.end!) &&
        minutesOf(ex.start!) < minutesOf(candidate.end!)) return ex
  }
  return null
}

export const COVERAGE_LABEL: Record<CoverageLevel, string> = {
  closed: 'Nobody scheduled',
  none: 'Nobody working',
  red: 'Below minimum',
  yellow: 'Thin',
  green: 'Covered',
}

// ── Week / period per-day coverage summary ───────────────────────────────────

/**
 * One block of the day's strip (an hour, or two). Its grade is the worst
 * monitored slot inside it, so a single thin dip still colours the whole block;
 * `level: 'closed'` marks a block that is unmonitored or unstaffed throughout.
 */
export interface HourCoverage {
  startMin: number
  endMin: number
  working: number
  onBreak: number
  onException: number
  level: CoverageLevel
}

/**
 * A whole day's coverage boiled down for the week and period grids, where each
 * day is a single narrow column with no room for the day view's intraday strip.
 *
 * The cell colour grades the day's *trough* (its worst simultaneous working
 * count) against the department threshold — a day is only as covered as its
 * thinnest moment. The hourly breakdown is carried in the hover, so the colour
 * you scan and the numbers you check come from the same basis.
 */
export interface DayCoverage {
  /** Grade of the day's worst monitored moment — drives the headline status. */
  level: CoverageLevel
  /** Working headcount at that worst moment, so the colour and number agree. */
  trough: number
  /** Peak headcount scheduled that day, used to tell 'closed' from 'thin'. */
  scheduled: number
  /** Blocks spanning the whole day, one per `blockMins`, for the strip + hover. */
  hours: HourCoverage[]
}

export function dayCoverage(
  people: MockPerson[],
  date: string,
  windows: CoverageWindow[],
  slotMins = 15,
  blockMins = 60,
): DayCoverage {
  const dayShifts = people
    .map(p => p.shifts.find(s => s.date === date))
    .filter((s): s is MockShift => !!s)
  const axis = buildDayAxis(dayShifts)
  const slots = buildCoverage(people, date, axis, slotMins)

  const scheduled = slots.reduce((m, s) => Math.max(m, s.working + s.onBreak + s.onException), 0)

  // The worst monitored, staffed slot drives the headline count.
  let level: CoverageLevel = 'closed'
  let trough = 0
  let worstSev = -1
  for (const s of slots) {
    const lvl = slotLevel(s, windows)
    if (lvl === 'closed') continue
    if (COVERAGE_SEVERITY[lvl] > worstSev) { worstSev = COVERAGE_SEVERITY[lvl]; level = lvl; trough = s.working }
  }

  // Blocks span the whole day so the strip reads as the day's timeframe. Each
  // block takes the worst (lowest) monitored slot inside it for its colour; a
  // block with no monitored slot is 'closed' and renders as a faint gap.
  const hours: HourCoverage[] = []
  for (let b = axis.startMin; b < axis.endMin; b += blockMins) {
    const end = Math.min(b + blockMins, axis.endMin)
    const monitored = slots.filter(s => s.startMin >= b && s.startMin < end && slotLevel(s, windows) !== 'closed')
    if (!monitored.length) {
      hours.push({ startMin: b, endMin: end, working: 0, onBreak: 0, onException: 0, level: 'closed' })
      continue
    }
    let worst = monitored[0]
    let sev = COVERAGE_SEVERITY[slotLevel(worst, windows)]
    for (const s of monitored) {
      const sSev = COVERAGE_SEVERITY[slotLevel(s, windows)]
      if (sSev > sev) { sev = sSev; worst = s }
    }
    hours.push({
      startMin: b,
      endMin: end,
      working: worst.working,
      onBreak: worst.onBreak,
      onException: worst.onException,
      level: slotLevel(worst, windows),
    })
  }

  return { level, trough, scheduled, hours }
}
