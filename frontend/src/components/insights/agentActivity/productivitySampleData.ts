/**
 * Sample data for the Insights → Productivity page (Phase 1 UI only).
 *
 * The report combines the streams that describe how an agent's clocked-in time
 * was actually spent: the punch clock, DeskTime computer activity, Genesys
 * routing status and presence, the call log, and ticket/task touches.
 *
 * Every value here is illustrative and deterministic (seeded by agent + date) so
 * the layout can be reviewed before the Phase 2 data layer lands. The shapes and
 * the status vocabularies mirror the real sources — see `productivityStatus.ts`
 * — so swapping in live data is a drop-in replacement.
 */

import { SAMPLE_AGENTS } from './placeholderData'
import {
  isOnQueue,
  type CallDirection, type ClockStatus, type DeskStatus, type PresenceStatus, type RoutingStatus,
} from './productivityStatus'

// ── Types ─────────────────────────────────────────────────────────────────────

/** A contiguous run of one status. Times are local "HH:MM" (24h). */
export interface StatusSpan<T extends string> { start: string; end: string; status: T }
export type RoutingSpan  = StatusSpan<RoutingStatus>
export type PresenceSpan = StatusSpan<PresenceStatus>
export type ClockSpan    = StatusSpan<ClockStatus>
export type DeskSpan     = StatusSpan<DeskStatus>

/** One conversation leg the agent participated in. */
export interface CallSpan {
  conversationId: string
  start: string
  end: string
  direction: CallDirection
  /** False when the call alerted but was never answered (Genesys NOT_RESPONDING). */
  answered: boolean
  /** True when the call was offered through a queue; false for direct/outbound. */
  acd: boolean
  holdMins: number
  /** After-call work (Genesys Wrapup segment). */
  wrapMins: number
  /** Passed to another agent or queue instead of being resolved on this call. */
  transferred: boolean
}

/**
 * Dialling effort for the day. Attempts that never reach a person are not
 * conversations, so they are carried as a daily total rather than as spans —
 * which also keeps ~30 one-minute marks off the Calls row. Mirrors the Genesys
 * aggregates (nOutbound, nConnected, tVoicemail) rather than tblSegments.
 */
export interface OutboundEffort {
  dials: number
  connected: number
  voicemail: number
  noAnswer: number
}

/** A one-minute bucket in which the agent touched one or more tickets/tasks. */
export interface TicketEvent {
  time: string
  updated: number
  completed: number
  ids: { id: string; action: 'Updated' | 'Completed' }[]
}

/** A carve-out of the scheduled shift (unpaid lunch or paid break). */
export interface ScheduleBreak { start: string; end: string; kind: 'Lunch' | 'Break' }
/** The planned shift, pulled from Scheduling (sample only in this phase). */
export interface ScheduleShift { start: string; end: string; breaks: ScheduleBreak[] }

/** All activity for one agent on one day, within the 8:00–18:00 work window. */
export interface AgentDay {
  schedule: ScheduleShift
  clock: ClockSpan[]
  desktime: DeskSpan[]
  routing: RoutingSpan[]
  presence: PresenceSpan[]
  calls: CallSpan[]
  outbound: OutboundEffort
  tickets: TicketEvent[]
}

/** Period roll-up shown on the roster table, one row per agent. */
export interface ProductivityRosterRow {
  agent: string
  /** Punched-in time over the period. */
  clockedMin: number
  /** Productive share of clocked time — the report's headline metric. */
  utilizationPct: number
  /** Answered calls per clocked hour. */
  callsPerHour: number
  /** Average handle time per answered call, in minutes. */
  ahtMins: number
  /** Calls that alerted and were never answered. */
  missedCalls: number
}

// ── The populations this report monitors ──────────────────────────────────────

/**
 * A comparison never crosses departments. Billing runs outbound collections, so
 * a high outbound share is the job there and would be alarming in Tech Support;
 * one shared median across both would flag correct behaviour as an exception.
 *
 * Installs is deliberately a department of one, so the drill-down exercises the
 * "no one to compare against" path — a solo department shows its own figures
 * with no peer column. Phase 2 maps this to the agent's real department.
 */
export type Department = 'Billing Customer Service' | 'Tech Support' | 'Installs'

export const AGENT_DEPARTMENT: Record<string, Department> = {
  'Jamie Waldie':        'Billing Customer Service',
  'Levi Roose':          'Billing Customer Service',
  'Megan Foti':          'Billing Customer Service',
  'Mitchell Stempowski': 'Tech Support',
  'Nick Robinson':       'Tech Support',
  'Steven Selley':       'Installs',
}

export const departmentOf = (agent: string): Department => AGENT_DEPARTMENT[agent] ?? 'Tech Support'

/** Everyone in the same department — the only agents a comparison may cross. */
export const peersIn = (dept: Department): string[] =>
  SAMPLE_AGENTS.filter(a => departmentOf(a) === dept)

// ── The reporting period ─────────────────────────────────────────────────────

/**
 * Ten business days: long enough for the header sparklines to show a direction
 * rather than three dots, and the period the roster totals are summed over.
 */
function businessDays(fromISO: string, count: number): string[] {
  const [y, m, d] = fromISO.split('-').map(Number)
  const cur = new Date(y, m - 1, d)
  const out: string[] = []
  while (out.length < count) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) {
      out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
    }
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export const SAMPLE_DATES: string[] = businessDays('2026-06-15', 10)

/** Local-date construction on purpose: `new Date('2026-06-15')` is UTC midnight,
 *  which renders as the previous day west of Greenwich. */
export const SAMPLE_DATE_LABELS: Record<string, string> = Object.fromEntries(
  SAMPLE_DATES.map(iso => {
    const [y, m, d] = iso.split('-').map(Number)
    return [iso, new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })]
  }),
)

// ── Deterministic generator ─────────────────────────────────────────────────

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Small seeded PRNG (mulberry32) so a given agent+date always yields the same day. */
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const seedFor = (agent: string, date: string) => {
  const s = agent + date
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const WIN_START = toMin('08:00')
const WIN_END = toMin('18:00')

/**
 * Routing statuses in a plausible working rhythm, biased per group: collections
 * work is mostly outbound dialling (COMMUNICATING), while tech support splits
 * between queued calls (INTERACTING) and outbound follow-ups.
 *
 * NOT_RESPONDING is not in either cycle — it is injected rarely below, matching
 * how uncommon it is in the real table (1,823 of 419,918 intervals).
 */
const ROUTING_CYCLE: Record<Department, RoutingStatus[]> = {
  'Billing Customer Service': [
    'COMMUNICATING', 'IDLE', 'COMMUNICATING', 'OFF_QUEUE', 'COMMUNICATING',
    'IDLE', 'INTERACTING', 'COMMUNICATING', 'OFF_QUEUE', 'COMMUNICATING',
  ],
  'Tech Support': [
    'IDLE', 'INTERACTING', 'IDLE', 'COMMUNICATING', 'OFF_QUEUE',
    'INTERACTING', 'COMMUNICATING', 'IDLE', 'INTERACTING', 'OFF_QUEUE',
  ],
  'Installs': [
    'INTERACTING', 'IDLE', 'COMMUNICATING', 'INTERACTING', 'OFF_QUEUE',
    'IDLE', 'COMMUNICATING', 'INTERACTING', 'OFF_QUEUE', 'IDLE',
  ],
}

/**
 * Per-agent work rate. Slower agents spend longer off queue, run shorter calls,
 * and touch fewer tickets, so the peer comparison in the drill-down has real
 * spread instead of six near-identical days.
 *
 * Each group deliberately contains one clear laggard, because a review dataset
 * where nothing is out of line cannot show whether the exception surfaces.
 */
const AGENT_PACE: Record<string, number> = {
  'Jamie Waldie':        1.25,
  'Levi Roose':          1.05,
  'Megan Foti':          0.60,
  'Mitchell Stempowski': 1.30,
  'Nick Robinson':       0.65,
  'Steven Selley':       1.00,
}

const paceFor = (agent: string): number => AGENT_PACE[agent] ?? 1

/**
 * Extra dials burned per connected outbound call. Collections works a list, so
 * most attempts reach voicemail; tech support dials a customer who is expecting
 * the call back and usually gets them.
 */
const DIAL_ATTEMPTS: Record<Department, number> = {
  'Billing Customer Service': 4,
  'Tech Support': 1,
  'Installs': 2,
}

/** Off-queue reasons other than the midday meal. */
const OFF_QUEUE_REASONS: PresenceStatus[] = [
  'Break', 'Meeting', 'Training', 'Follow-Up Extended', 'In Warehouse', 'Available',
]

/** Collapse consecutive spans that share a status into one run. */
function mergeSpans<T extends string>(spans: StatusSpan<T>[]): StatusSpan<T>[] {
  return spans.reduce<StatusSpan<T>[]>((acc, s) => {
    const prev = acc[acc.length - 1]
    if (prev && prev.status === s.status && prev.end === s.start) prev.end = s.end
    else acc.push({ ...s })
    return acc
  }, [])
}

/** Build a plausible day for an agent from the seed. Pure + deterministic. */
export function getAgentDay(agent: string, date: string): AgentDay {
  const rng = makeRng(seedFor(agent, date))
  const seed = seedFor(agent, date)
  const dept = departmentOf(agent)
  const cycle_ = ROUTING_CYCLE[dept]
  const pace = paceFor(agent)

  // Shift starts near 8:00, ends near 17:00–17:30.
  let cursor = WIN_START + Math.floor(rng() * 20)
  const shiftEnd = WIN_END - 30 - Math.floor(rng() * 60)

  const routing: RoutingSpan[] = []
  const presenceRaw: PresenceSpan[] = []
  const calls: CallSpan[] = []
  const tickets: TicketEvent[] = []
  const outbound: OutboundEffort = { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }
  let cycle = 0
  let ticketSeq = 1
  let callSeq = 1

  while (cursor < shiftEnd) {
    let status = cycle_[cycle % cycle_.length]
    cycle++

    // A queued call that alerted and timed out — always brief, always rare.
    if (status === 'IDLE' && rng() > 0.9) status = 'NOT_RESPONDING'

    const len =
      status === 'NOT_RESPONDING' ? 1 :
      status === 'OFF_QUEUE'      ? Math.round((12 + rng() * 24) / pace) :
      status === 'INTERACTING'    ? Math.max(2, Math.round((6 + rng() * 13) * pace)) :
      status === 'COMMUNICATING'  ? Math.max(2, Math.round((5 + rng() * 11) * pace)) :
                                    6 + Math.floor(rng() * 15)
    const end = Math.min(shiftEnd, cursor + len)
    routing.push({ start: toHHMM(cursor), end: toHHMM(end), status })

    // Presence runs alongside routing: "On Queue" whenever reachable, otherwise
    // the reason the agent stepped out (a meal around midday).
    const reason: PresenceStatus = isOnQueue(status)
      ? 'On Queue'
      : cursor >= 11 * 60 + 30 && cursor <= 13 * 60 + 30
        ? 'Meal'
        : OFF_QUEUE_REASONS[Math.floor(rng() * OFF_QUEUE_REASONS.length)]
    presenceRaw.push({ start: toHHMM(cursor), end: toHHMM(end), status: reason })

    // Conversations: queued interactions are inbound ACD, communicating spans
    // are the direct/outbound dials, and a timeout is an unanswered ACD call.
    if (status === 'INTERACTING' || status === 'COMMUNICATING' || status === 'NOT_RESPONDING') {
      const acd = status !== 'COMMUNICATING'
      const answered = status !== 'NOT_RESPONDING'
      calls.push({
        conversationId: `C-${(seed % 9000) + 1000}-${callSeq++}`,
        start: toHHMM(cursor),
        end: toHHMM(answered ? end : Math.min(end, cursor + 1)),
        direction: acd ? 'Inbound' : 'Outbound',
        answered,
        acd,
        holdMins: answered && rng() > 0.78 ? 1 + Math.floor(rng() * 3) : 0,
        wrapMins: answered ? 1 + Math.floor(rng() * 3) : 0,
        transferred: answered && rng() > 0.86,
      })

      // Reaching that person cost some unanswered attempts first.
      if (status === 'COMMUNICATING') {
        const wasted = Math.round(rng() * DIAL_ATTEMPTS[dept])
        const vm = Math.round(wasted * 0.6)
        outbound.connected += 1
        outbound.dials += 1 + wasted
        outbound.voicemail += vm
        outbound.noAnswer += wasted - vm
      }
    }

    // Ticket/task touches happen while off queue or waiting between calls.
    if ((status === 'OFF_QUEUE' || status === 'IDLE') && rng() > 0.85 - 0.45 * pace) {
      // Pace drives how many tickets get cleared in one sitting, which is what
      // produces the roughly 2× spread in touches-per-hour across the roster.
      const count = Math.max(1, Math.round(pace * (0.4 + rng() * 2.2)))
      const at = cursor + Math.floor(rng() * Math.max(1, end - cursor))
      const ids = Array.from({ length: count }, () => ({
        id: `T-${(seed % 900) + 100}${ticketSeq++}`,
        action: (rng() > 0.7 ? 'Completed' : 'Updated') as 'Completed' | 'Updated',
      }))
      tickets.push({
        time: toHHMM(at),
        updated: ids.filter(i => i.action === 'Updated').length,
        completed: ids.filter(i => i.action === 'Completed').length,
        ids,
      })
    }

    cursor = end
  }

  // Punch clock: mostly Working, with a midday meal and an afternoon break.
  const clock: ClockSpan[] = []
  const s0 = routing.length ? toMin(routing[0].start) : WIN_START
  const mealStart = 12 * 60 + Math.floor(rng() * 40)
  clock.push({ start: toHHMM(s0), end: toHHMM(mealStart), status: 'Working' })
  clock.push({ start: toHHMM(mealStart), end: toHHMM(mealStart + 30), status: 'Meal' })
  const afternoonEnd = shiftEnd - 20 - Math.floor(rng() * 30)
  clock.push({ start: toHHMM(mealStart + 30), end: toHHMM(afternoonEnd), status: 'Working' })
  clock.push({ start: toHHMM(afternoonEnd), end: toHHMM(afternoonEnd + 12), status: 'Break' })
  clock.push({ start: toHHMM(afternoonEnd + 12), end: toHHMM(shiftEnd), status: 'Working' })

  // DeskTime computer activity: within clocked-in Working time the agent is
  // mostly Active with short Idle stretches; away from the desk reads as Idle.
  const desktime: DeskSpan[] = []
  for (const c of clock) {
    const cs = toMin(c.start), ce = toMin(c.end)
    if (c.status !== 'Working') { desktime.push({ start: c.start, end: c.end, status: 'Idle' }); continue }
    let cur = cs
    while (cur < ce) {
      const activeEnd = Math.min(ce, cur + 18 + Math.floor(rng() * 42))
      desktime.push({ start: toHHMM(cur), end: toHHMM(activeEnd), status: 'Active' })
      cur = activeEnd
      if (cur < ce) {
        const idleEnd = Math.min(ce, cur + 3 + Math.floor(rng() * 8))
        if (idleEnd > cur) desktime.push({ start: toHHMM(cur), end: toHHMM(idleEnd), status: 'Idle' })
        cur = idleEnd
      }
    }
  }

  // Planned shift from Scheduling — clean round times that loosely bound the
  // real activity, with an unpaid lunch and a paid afternoon break.
  const schedStart = rng() > 0.5 ? WIN_START : WIN_START + 30
  const schedEnd = schedStart + 9 * 60
  const lunchStart = rng() > 0.5 ? 12 * 60 : 12 * 60 + 30
  const schedule: ScheduleShift = {
    start: toHHMM(schedStart),
    end: toHHMM(schedEnd),
    breaks: [
      { start: toHHMM(lunchStart), end: toHHMM(lunchStart + 30), kind: 'Lunch' },
      { start: toHHMM(15 * 60), end: toHHMM(15 * 60 + 15), kind: 'Break' },
    ],
  }

  return { schedule, clock, desktime, routing, presence: mergeSpans(presenceRaw), calls, outbound, tickets }
}

// The period roster is rolled up from these generated days in
// `productivityBenchmark.ts`, not hand-written, so a row's totals always agree
// with the drill-down that opens beneath it.
