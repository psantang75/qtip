/**
 * Timeline geometry for the Productivity day drill-down, plus the derivation of
 * the Status row.
 *
 * Split out of `productivityModel.ts` because the Status row is the one row that
 * has to reconcile TWO independent Genesys streams rather than draw the single
 * stream it is handed: routing status says whether the agent was reachable in
 * queue, primary presence says why they were not, and the two change on
 * different clocks. That reconciliation is the subtle part of the page, so it
 * gets its own module and its own tests.
 */

import { isOnQueue, type PresenceStatus, type RoutingStatus } from './productivityStatus'
import type { PresenceSpan, RoutingSpan } from './productivityTypes'

/** "HH:MM" (24h) → minutes from midnight. */
export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** The activity timeline is quantised to this grid, in minutes. */
export const BLOCK_MIN = 5

// ── The shared axis ──────────────────────────────────────────────────────────

/**
 * The drawn time axis every row positions against. Rows must be absolutely
 * positioned rather than flex-proportional, or a stream that starts later than
 * the axis (the punch clock against an earlier scheduled start, for example)
 * silently stretches to fill its row and stops lining up with the hour ticks.
 */
export interface Axis {
  startMin: number
  endMin: number
  /** Minutes-from-midnight → its position across the axis, in percent. */
  at: (min: number) => number
  /** A duration in minutes → its width across the axis, in percent. */
  span: (mins: number) => number
}

export function makeAxis(startMin: number, endMin: number): Axis {
  const total = Math.max(1, endMin - startMin)
  return {
    startMin,
    endMin,
    at: (min: number) => ((min - startMin) / total) * 100,
    span: (mins: number) => (mins / total) * 100,
  }
}

// ── Segments ─────────────────────────────────────────────────────────────────

export interface Segment<T extends string> {
  status: T
  mins: number
  startMin: number
  endMin: number
  leftPct: number
  widthPct: number
}

/** A run given by its minute bounds, placed on the axis. */
export function placeMin<T extends string>(axis: Axis, status: T, startMin: number, endMin: number): Segment<T> {
  return {
    status,
    startMin,
    endMin,
    mins: endMin - startMin,
    leftPct: axis.at(startMin),
    widthPct: axis.span(endMin - startMin),
  }
}

/** A run given as an "HH:MM" span, placed on the axis. */
export function place<T extends string>(axis: Axis, s: { start: string; end: string; status: T }): Segment<T> {
  return placeMin(axis, s.status, toMin(s.start), toMin(s.end))
}

/** A routing-status run, annotated with the presence reason when off queue. */
export interface StatusSegment extends Segment<RoutingStatus> {
  reason: PresenceStatus | null
}

/**
 * The Status row's runs, reconciled from the routing and presence streams.
 *
 * An off-queue run is CUT at the presence boundaries rather than labelled as a
 * whole. Genesys does not return the agent to queue between two off-queue
 * reasons, so a meeting that runs straight into a break is one uninterrupted
 * OFF_QUEUE run — labelling the run with a single reason erases whichever of the
 * two did not win, and reports the meeting's minutes as break time in both the
 * timeline and the Phone Status card.
 *
 * Off-queue minutes that no presence span covers keep `reason: null` and read as
 * plain "Off queue". Genesys emits sub-minute presence blips that collapse to
 * nothing at the minute resolution the feed is read at, and stretching a
 * neighbour's reason across that gap would report time the agent never spent
 * there.
 *
 * An agent who never joins a phone queue (an admin who takes no calls) has no
 * routing status at all — Genesys only records their presence. Each presence
 * span is then its own off-queue run, so the row still shows what they were
 * doing (Available / Break / Meal / Away) instead of going blank.
 */
export function buildStatusSegments(
  axis: Axis,
  routing: RoutingSpan[],
  presence: PresenceSpan[],
): StatusSegment[] {
  if (routing.length === 0) {
    return presence.map(p => ({
      ...placeMin<RoutingStatus>(axis, 'OFF_QUEUE', toMin(p.start), toMin(p.end)),
      reason: p.status,
    }))
  }

  const reasons = presence
    .map(p => ({ startMin: toMin(p.start), endMin: toMin(p.end), status: p.status }))
    .sort((a, b) => a.startMin - b.startMin)

  const out: StatusSegment[] = []
  for (const run of routing) {
    const runStart = toMin(run.start)
    const runEnd = toMin(run.end)
    if (runEnd <= runStart) continue
    if (isOnQueue(run.status)) {
      out.push({ ...placeMin(axis, run.status, runStart, runEnd), reason: null })
      continue
    }

    // Walk the run left to right, emitting one segment per presence overlap and
    // one unlabelled segment for each stretch no presence span reaches. The
    // cursor only ever moves forward, so overlapping presence spans cannot
    // double-count a minute.
    let cursor = runStart
    for (const r of reasons) {
      if (r.startMin >= runEnd) break
      const from = Math.max(cursor, r.startMin)
      const to = Math.min(runEnd, r.endMin)
      if (to <= from) continue
      if (from > cursor) out.push({ ...placeMin(axis, run.status, cursor, from), reason: null })
      out.push({ ...placeMin(axis, run.status, from, to), reason: r.status })
      cursor = to
    }
    if (cursor < runEnd) out.push({ ...placeMin(axis, run.status, cursor, runEnd), reason: null })
  }
  return out
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/** One slice of colour inside a Status bar, measured against the BAR's width. */
export interface StatusSlice {
  leftPct: number
  widthPct: number
  status: RoutingStatus
  reason: PresenceStatus | null
}

/**
 * A single 5-minute bar of the Status row. The row is drawn as a continuous run
 * of these bars so the day reads as discrete five-minute blocks rather than a
 * few long runs.
 *
 * The bar is FILLED from `slices`, not from one dominant colour: a meeting that
 * ends at 3:44 has to stop at 3:44 rather than round out to 3:45. Because the
 * feed is read at minute resolution, the exact intersections inside a bar are
 * always whole minutes, so a bar carries at most five slices. `status` /
 * `reason` name whatever covered most of the bar, for readers that want a single
 * answer for the block.
 */
export interface StatusBlock {
  startMin: number
  leftPct: number
  widthPct: number
  status: RoutingStatus
  reason: PresenceStatus | null
  slices: StatusSlice[]
}

/**
 * Cut the Status runs into the continuous row of 5-minute bars. Only slots that
 * fall inside a run get a bar, so the empty time before and after the shift
 * stays blank rather than drawing empty bars.
 */
export function toStatusBlocks(axis: Axis, segs: StatusSegment[]): StatusBlock[] {
  const out: StatusBlock[] = []
  const blockWidth = axis.span(BLOCK_MIN)

  for (let s = axis.startMin; s < axis.endMin; s += BLOCK_MIN) {
    const e = s + BLOCK_MIN
    const slices: StatusSlice[] = []
    let dominant: StatusSegment | null = null
    let best = 0

    for (const seg of segs) {
      const from = Math.max(seg.startMin, s)
      const to = Math.min(seg.endMin, e)
      if (to <= from) continue
      if (to - from > best) { best = to - from; dominant = seg }
      slices.push({
        leftPct: ((from - s) / BLOCK_MIN) * 100,
        widthPct: ((to - from) / BLOCK_MIN) * 100,
        status: seg.status,
        reason: seg.reason,
      })
    }

    if (!dominant) continue
    out.push({
      startMin: s,
      leftPct: axis.at(s),
      widthPct: blockWidth,
      status: dominant.status,
      reason: dominant.reason,
      slices,
    })
  }
  return out
}
