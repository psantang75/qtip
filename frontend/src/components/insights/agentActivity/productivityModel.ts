/**
 * Pure derivations for the Productivity day drill-down. Turns a raw `AgentDay`
 * into the presentational model the timeline and summary panels render, so the
 * components stay layout-only.
 *
 * Every segment carries its own `leftPct` / `widthPct` against the shared day
 * axis — rows must be absolutely positioned rather than flex-proportional, or a
 * stream that starts later than the axis (the punch clock against an earlier
 * scheduled start, for example) silently stretches to fill the row and stops
 * lining up with the hour ticks.
 *
 * Color tokens and status vocabularies live in `productivityStatus.ts`.
 */

import type {
  AgentDay, CallSpan, TicketEvent,
} from './productivityTypes'
import {
  PRESENCE_ORDER, isEngaged, isOnQueue,
  type CallLabel, type ClockStatus, type PresenceStatus, type RoutingStatus,
} from './productivityStatus'

// ── Formatting ──────────────────────────────────────────────────────────────

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Minutes → compact "Xh Ym" (e.g. 402 → "6h 42m", 45 → "45m"). */
export function fmtHM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Fractional minutes → "6m 12s". For averages per call, where seconds matter. */
export function fmtMS(mins: number): string {
  const total = Math.round(mins * 60)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** Minutes-from-midnight → "9:05 AM". */
export function fmtClock(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// ── Model ─────────────────────────────────────────────────────────────────────

export interface Segment<T extends string> {
  status: T
  mins: number
  startMin: number
  endMin: number
  leftPct: number
  widthPct: number
}

/** A routing-status run, annotated with the presence reason when off queue. */
export interface StatusSegment extends Segment<RoutingStatus> {
  reason: PresenceStatus | null
}

export interface CallMark {
  leftPct: number; widthPct: number; label: CallLabel; mins: number
  startMin: number; endMin: number; conversationId: string; acd: boolean
  holdMins: number; wrapMins: number
}
/** One call that fell inside a 5-minute block, kept for the block's hover detail. */
export interface CallInBlock {
  conversationId: string; label: CallLabel; startMin: number; endMin: number
  acd: boolean; holdMins: number; wrapMins: number
}

/**
 * One 5-minute slot of the Calls row that had activity. Individual calls are too
 * small and too many to draw one-per-line, so each active slot is a single hard
 * block coloured by what dominated it; the exact calls (with their real times,
 * e.g. 8:07) live in the hover detail.
 */
export interface CallBlock {
  startMin: number; leftPct: number; widthPct: number
  tone: 'inbound' | 'outbound' | 'missed'
  inboundMins: number; outboundMins: number; missed: number
  calls: CallInBlock[]
}

/** One 5-minute slot of the Tickets row that had activity, with its touches. */
export interface TicketBlock {
  startMin: number; leftPct: number; widthPct: number
  tone: 'completed' | 'updated'
  completed: number; updated: number; ids: TicketEvent['ids']
}

/**
 * A single 5-minute bar of the phone Status row. The row is drawn as a
 * continuous run of these bars so the day reads as discrete five-minute blocks
 * rather than a few long runs. The bar is coloured by whichever status covered
 * most of its five minutes; the exact status runs (and any shorter switches
 * hiding inside the block) are listed in the bar's hover detail.
 */
export interface StatusBlock {
  startMin: number; leftPct: number; widthPct: number
  status: RoutingStatus; reason: PresenceStatus | null
}

export interface SummaryRow<T extends string> { status: T; mins: number; pct: number }

/** The activity timeline is quantised to this grid, in minutes. */
export const BLOCK_MIN = 5

/** The fixed on-screen axis window: 8:00 AM to 6:30 PM. Activity outside it
 *  extends the axis and scrolls into view rather than rescaling the day. */
export const WINDOW_START = 8 * 60
export const WINDOW_END = 18 * 60 + 30

/**
 * The four grades of gridline on the shared axis. Hour lines are the strongest
 * and carry a full label; the finer intervals step down in weight so the axis
 * can be read to five-minute precision without a number at every tick.
 */
export type TickTier = 'hour' | 'half' | 'quarter' | 'five'
export interface AxisTick { min: number; leftPct: number; tier: TickTier; label: string | null }

/**
 * One line of the clocked-time waterfall. The buckets are mutually exclusive and
 * sum back to clocked minutes, so "where did the rest of the day go" has an
 * answer on the page instead of being inferred from what is missing.
 */
export interface TimeBucket { key: string; label: string; mins: number; pct: number }
export interface ScheduleBar { leftPct: number; widthPct: number; startMin: number; endMin: number }
export interface ScheduleSegment { leftPct: number; widthPct: number; kind: 'Lunch' | 'Break'; startMin: number; endMin: number }

export interface DayModel {
  hasData: boolean
  startMin: number
  endMin: number
  windowLabel: string
  scheduleBar: ScheduleBar | null
  scheduleSegments: ScheduleSegment[]
  statusSegments: StatusSegment[]
  clockSegments: Segment<ClockStatus>[]
  /** Phone Status, drawn as a continuous run of 5-minute bars. */
  statusBlocks: StatusBlock[]
  /** Calls and tickets, aggregated into 5-minute blocks for the timeline. */
  callBlocks: CallBlock[]
  ticketBlocks: TicketBlock[]
  /** Every tick on the shared axis, from hour lines down to 5-minute ticks. */
  axisTicks: AxisTick[]
  /** Off-queue time grouped by presence reason. */
  offQueueSummary: SummaryRow<PresenceStatus>[]
  /** Every clocked minute, assigned to exactly one bucket. */
  timeAccounting: TimeBucket[]
  callSummary: {
    total: number; answered: number; missed: number; inbound: number; outbound: number
    talkMins: number; holdMins: number; wrapMins: number
    /** Talk + hold + after-call work: the whole cost of handling calls. */
    handleMins: number
    /** Average handle time per answered call, in minutes. */
    ahtMins: number
    /** Average after-call work per answered call, in minutes. */
    acwMins: number
    /** Answered calls passed to another agent or queue. */
    transferred: number
    heldCount: number
    longestMins: number
    /** Answered calls that lasted under one minute. */
    underOneMin: number
    /** Answered calls that lasted one minute or more. */
    overOneMin: number
    /** Outbound dialling effort, including attempts that reached nobody. */
    dials: number; connected: number; voicemail: number; noAnswer: number
  }
  ticketTotals: { total: number; updated: number; completed: number }
  /** Paid minutes: worked time plus paid breaks, excluding the unpaid meal. The
   *  productivity denominator (shown to the user as "Paid time"). */
  clockedMin: number
  onQueueMin: number
  offQueueMin: number
  /** Interacting + Communicating. */
  engagedMin: number
  /** Engaged minutes that fall inside punched-in working time. */
  onCallMin: number
  /** Engaged share of on-queue time — the report's headline metric. */
  occupancyPct: number
  /** Phone-handle share of clocked (paid) time. */
  utilizationPct: number
  notRespondingCount: number
}

interface Bounds { startMin: number; endMin: number }

/** The intervals two sets have in common. Both inputs are non-overlapping runs. */
function intersect(a: Bounds[], b: Bounds[]): Bounds[] {
  const out: Bounds[] = []
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.startMin, y.startMin)
      const e = Math.min(x.endMin, y.endMin)
      if (e > s) out.push({ startMin: s, endMin: e })
    }
  }
  return out
}

const spanMins = (bs: Bounds[]) => bs.reduce((a, s) => a + (s.endMin - s.startMin), 0)
const overlapMins = (a: Bounds[], b: Bounds[]) => spanMins(intersect(a, b))

function summarize<T extends string>(segs: { status: T; mins: number }[], order: T[]): SummaryRow<T>[] {
  const totals = new Map<T, number>()
  segs.forEach(s => totals.set(s.status, (totals.get(s.status) ?? 0) + s.mins))
  const grand = Math.max(1, [...totals.values()].reduce((a, b) => a + b, 0))
  return order
    .filter(st => (totals.get(st) ?? 0) > 0)
    .map(st => ({ status: st, mins: totals.get(st)!, pct: Math.round((totals.get(st)! / grand) * 100) }))
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export function buildDayModel(day: AgentDay | null): DayModel {
  const routing = day?.routing ?? []
  const presence = day?.presence ?? []
  const sched = day?.schedule ?? null
  const schedStart = sched ? toMin(sched.start) : null
  const schedEnd = sched ? toMin(sched.end) : null

  // The axis spans everything on screen — including the planned shift — so no
  // row can overflow the shared time window.
  const raw = [...routing, ...(day?.clock ?? [])]
  const allStarts = raw.map(s => toMin(s.start))
  const allEnds = raw.map(s => toMin(s.end))
  if (schedStart !== null) allStarts.push(schedStart)
  if (schedEnd !== null) allEnds.push(schedEnd)
  const hasData = allStarts.length > 0
  // The precise worked window, kept for the summary line's exact times.
  const workedStart = hasData ? Math.min(...allStarts) : 0
  const workedEnd = hasData ? Math.max(...allEnds) : 0
  // The drawn axis is a fixed 8:00 AM – 6:30 PM window so every day reads against
  // the same grid regardless of when the agent actually clocked in. A day that
  // runs earlier or later than the window extends the axis out to whole hours —
  // the extra time simply scrolls into view (the timeline sets a fixed
  // pixels-per-minute width), it is never squeezed to fit.
  const startMin = hasData ? Math.min(WINDOW_START, Math.floor(workedStart / 60) * 60) : WINDOW_START
  const endMin = hasData ? Math.max(WINDOW_END, Math.ceil(workedEnd / 60) * 60) : WINDOW_END
  const total = Math.max(1, endMin - startMin)

  const pct = (m: number) => ((m - startMin) / total) * 100
  const place = <T extends string>(s: { start: string; end: string; status: T }): Segment<T> => {
    const a = toMin(s.start), b = toMin(s.end)
    return { status: s.status, startMin: a, endMin: b, mins: b - a, leftPct: pct(a), widthPct: ((b - a) / total) * 100 }
  }

  const blockWidth = (BLOCK_MIN / total) * 100

  /**
   * Cut a set of exact runs into a continuous row of 5-minute bars, each carrying
   * the run that covered most of it plus a count of the shorter switches inside.
   * Only slots that fall inside a run get a bar, so the empty time before and
   * after the shift stays blank rather than drawing empty bars.
   */
  function toBlocks<S extends { startMin: number; endMin: number }>(segs: S[]): { startMin: number; leftPct: number; widthPct: number; cover: S }[] {
    const out: { startMin: number; leftPct: number; widthPct: number; cover: S }[] = []
    if (!hasData) return out
    for (let s = startMin; s < endMin; s += BLOCK_MIN) {
      const e = s + BLOCK_MIN
      let cover: S | null = null, best = 0
      for (const seg of segs) {
        const ov = Math.min(seg.endMin, e) - Math.max(seg.startMin, s)
        if (ov <= 0) continue
        if (ov > best) { best = ov; cover = seg }
      }
      if (cover) out.push({ startMin: s, leftPct: pct(s), widthPct: blockWidth, cover })
    }
    return out
  }

  const clockSegments = (day?.clock ?? []).map(s => place<ClockStatus>(s))

  // Off-queue runs are labelled with whichever presence span covers their
  // midpoint, so the timeline can name the reason without a second row.
  const statusSegments: StatusSegment[] = routing.map(s => {
    const seg = place<RoutingStatus>(s)
    if (isOnQueue(seg.status)) return { ...seg, reason: null }
    const mid = (seg.startMin + seg.endMin) / 2
    const hit = presence.find(p => toMin(p.start) <= mid && toMin(p.end) >= mid)
    return { ...seg, reason: hit?.status ?? null }
  })

  const statusBlocks: StatusBlock[] = toBlocks(statusSegments).map(b => ({
    startMin: b.startMin, leftPct: b.leftPct, widthPct: b.widthPct,
    status: b.cover.status, reason: b.cover.reason,
  }))

  const scheduleBar: ScheduleBar | null = sched && schedStart !== null && schedEnd !== null
    ? { leftPct: pct(schedStart), widthPct: ((schedEnd - schedStart) / total) * 100, startMin: schedStart, endMin: schedEnd }
    : null
  const scheduleSegments: ScheduleSegment[] = (sched?.breaks ?? []).map(b => {
    const s = toMin(b.start), e = toMin(b.end)
    return { leftPct: pct(s), widthPct: ((e - s) / total) * 100, kind: b.kind, startMin: s, endMin: e }
  })

  // A "missed" call is an inbound/queued call that alerted and went unanswered.
  // An unanswered OUTBOUND leg is a dial that reached nobody — that is dialling
  // effort (surfaced in the Dialing summary), not a missed call, so it is not
  // drawn on the Calls row and never counted as missed.
  const callMarks: CallMark[] = (day?.calls ?? [])
    .filter((c: CallSpan) => c.answered || c.acd)
    .map((c: CallSpan) => {
      const s = toMin(c.start), e = toMin(c.end)
      return {
        leftPct: Math.max(0, pct(s)),
        widthPct: Math.max(0.4, ((e - s) / total) * 100),
        label: !c.answered ? 'Missed' : c.direction,
        mins: e - s, startMin: s, endMin: e,
        conversationId: c.conversationId, acd: c.acd, holdMins: c.holdMins, wrapMins: c.wrapMins,
      }
    })

  // ── 5-minute blocks for the Calls and Tickets rows ────────────────────────
  const callBlocks: CallBlock[] = []
  const ticketEvents = day?.tickets ?? []
  const ticketBlocks: TicketBlock[] = []

  if (hasData) {
    for (let s = startMin; s < endMin; s += BLOCK_MIN) {
      const e = s + BLOCK_MIN

      // Calls: sum answered talk-minutes by direction inside the slot, count a
      // missed call in the slot it started, and keep every call for the tooltip.
      let inboundMins = 0, outboundMins = 0, missed = 0
      const calls: CallInBlock[] = []
      for (const c of callMarks) {
        const ov = Math.min(c.endMin, e) - Math.max(c.startMin, s)
        const startsHere = c.startMin >= s && c.startMin < e
        if (ov <= 0 && !startsHere) continue
        if (c.label === 'Missed') {
          if (!startsHere) continue
          missed += 1
        } else if (c.label === 'Inbound') {
          inboundMins += Math.max(0, ov)
        } else {
          outboundMins += Math.max(0, ov)
        }
        calls.push({
          conversationId: c.conversationId, label: c.label, startMin: c.startMin, endMin: c.endMin,
          acd: c.acd, holdMins: c.holdMins, wrapMins: c.wrapMins,
        })
      }
      if (calls.length > 0) {
        const tone: CallBlock['tone'] =
          inboundMins === 0 && outboundMins === 0 ? 'missed' :
          inboundMins >= outboundMins ? 'inbound' : 'outbound'
        callBlocks.push({ startMin: s, leftPct: pct(s), widthPct: blockWidth, tone, inboundMins, outboundMins, missed, calls })
      }

      // Tickets: touches are instantaneous, so a slot simply gathers the events
      // whose timestamp falls inside it.
      let completed = 0, updated = 0
      const ids: TicketEvent['ids'] = []
      for (const t of ticketEvents) {
        const tm = toMin(t.time)
        if (tm < s || tm >= e) continue
        completed += t.completed
        updated += t.updated
        ids.push(...t.ids)
      }
      if (ids.length > 0) {
        ticketBlocks.push({
          startMin: s, leftPct: pct(s), widthPct: blockWidth,
          tone: completed >= updated ? 'completed' : 'updated', completed, updated, ids,
        })
      }
    }
  }

  // Four-tier grid of gridlines: an hour line every 60m (the only tier that
  // carries a label, e.g. "8:00 AM"), then half / quarter / five-minute lines
  // that step down in weight so the axis can be read to five minutes without a
  // number at every tick. Sub-hour times are read from a bar's hover instead.
  const axisTicks: AxisTick[] = []
  if (hasData) {
    for (let m = startMin; m <= endMin; m += 5) {
      const inHour = m % 60
      const tier: TickTier =
        inHour === 0 ? 'hour' :
        inHour === 30 ? 'half' :
        inHour === 15 || inHour === 45 ? 'quarter' :
        'five'
      axisTicks.push({ min: m, leftPct: pct(m), tier, label: tier === 'hour' ? fmtClock(m) : null })
    }
  }

  // ── Time totals ───────────────────────────────────────────────────────────
  const sumMins = (segs: { mins: number }[]) => segs.reduce((a, s) => a + s.mins, 0)

  // Paid time = time the employer is paying for: worked time plus paid rest
  // breaks, but NOT the unpaid meal/lunch. This is the productivity denominator,
  // matching the contact-center convention where utilization is measured against
  // paid hours rather than raw punched-in ("clocked") time.
  const clockedMin = sumMins(clockSegments.filter(s => s.status === 'Working' || s.status === 'Break'))
  const onQueueSegs = statusSegments.filter(s => isOnQueue(s.status))
  const offQueueSegs = statusSegments.filter(s => !isOnQueue(s.status))
  const onQueueMin = sumMins(onQueueSegs)
  const offQueueMin = sumMins(offQueueSegs)
  const engagedMin = sumMins(statusSegments.filter(s => isEngaged(s.status)))

  // ── Paid-time waterfall ───────────────────────────────────────────────────
  // The buckets below partition paid time (worked time + paid breaks). Paid
  // breaks win over whatever the phone was reporting at the time; the unpaid meal
  // is not paid time, so it never appears here at all. Without a desk-activity
  // signal, time away from the queue is one bucket — it can't be split into
  // working vs idle — so "Off queue" carries the presence reason in its hover.
  const workBounds = clockSegments.filter(s => s.status === 'Working')
  const breakMin = sumMins(clockSegments.filter(s => s.status === 'Break'))
  const routingIn = (pick: (s: StatusSegment) => boolean) =>
    overlapMins(statusSegments.filter(pick), workBounds)

  const onCallMin = routingIn(s => isEngaged(s.status))
  const availableMin = routingIn(s => s.status === 'IDLE')
  const notRespondingMin = routingIn(s => s.status === 'NOT_RESPONDING')
  const offQueueMinInWork = spanMins(intersect(offQueueSegs, workBounds))

  const accounted = onCallMin + availableMin + notRespondingMin + offQueueMinInWork + breakMin
  const timeAccounting: TimeBucket[] = ([
    ['call',      'On a call',            onCallMin],
    ['available', 'Available in queue',   availableMin],
    ['offqueue',  'Off queue',            offQueueMinInWork],
    ['break',     'Paid break',           breakMin],
    ['noanswer',  'Not responding',       notRespondingMin],
    ['other',     'Unaccounted',          Math.max(0, clockedMin - accounted)],
  ] as [string, string, number][])
    .filter(([, , mins]) => mins > 0)
    .map(([key, label, mins]) => ({ key, label, mins, pct: pctOf(mins, clockedMin) }))

  const calls = day?.calls ?? []
  const answered = calls.filter(c => c.answered)
  const talkMins = callMarks.filter(c => c.label !== 'Missed').reduce((a, c) => a + c.mins, 0)
  const holdMins = calls.reduce((a, c) => a + c.holdMins, 0)
  const wrapMins = calls.reduce((a, c) => a + c.wrapMins, 0)
  const perCall = Math.max(1, answered.length)
  const out = day?.outbound ?? { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }
  const callSummary = {
    total: calls.length,
    answered: answered.length,
    // Inbound/queued calls that alerted and went unanswered — matches the roster's
    // Missed column and excludes outbound dials that reached nobody.
    missed: calls.filter(c => !c.answered && c.acd).length,
    inbound: answered.filter(c => c.direction === 'Inbound').length,
    outbound: answered.filter(c => c.direction === 'Outbound').length,
    talkMins, holdMins, wrapMins,
    handleMins: talkMins + holdMins + wrapMins,
    ahtMins: (talkMins + holdMins + wrapMins) / perCall,
    acwMins: wrapMins / perCall,
    transferred: answered.filter(c => c.transferred).length,
    heldCount: calls.filter(c => c.holdMins > 0).length,
    longestMins: callMarks.filter(c => c.label !== 'Missed').reduce((a, c) => Math.max(a, c.mins), 0),
    underOneMin: callMarks.filter(c => c.label !== 'Missed' && c.mins < 1).length,
    overOneMin: callMarks.filter(c => c.label !== 'Missed' && c.mins >= 1).length,
    dials: out.dials, connected: out.connected, voicemail: out.voicemail, noAnswer: out.noAnswer,
  }

  const ticketTotals = (day?.tickets ?? []).reduce(
    (acc, t) => ({ total: acc.total + t.updated + t.completed, updated: acc.updated + t.updated, completed: acc.completed + t.completed }),
    { total: 0, updated: 0, completed: 0 },
  )

  return {
    hasData, startMin, endMin,
    // The label reports the exact worked window, not the hour-snapped axis.
    windowLabel: hasData ? `${fmtClock(workedStart)} – ${fmtClock(workedEnd)}` : 'No data',
    scheduleBar, scheduleSegments,
    statusSegments, clockSegments, statusBlocks,
    callBlocks, ticketBlocks, axisTicks,
    offQueueSummary: summarize(
      offQueueSegs.filter(s => s.reason).map(s => ({ status: s.reason as PresenceStatus, mins: s.mins })),
      PRESENCE_ORDER,
    ),
    timeAccounting, callSummary, ticketTotals,
    clockedMin, onQueueMin, offQueueMin, engagedMin, onCallMin,
    occupancyPct: pctOf(engagedMin, onQueueMin),
    // Clock-restricted, so utilization agrees with the waterfall rather than
    // counting phone minutes logged over an unpunched break.
    utilizationPct: pctOf(onCallMin, clockedMin),
    notRespondingCount: statusSegments.filter(s => s.status === 'NOT_RESPONDING').length,
  }
}
