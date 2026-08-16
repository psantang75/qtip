/**
 * Turns one agent's day into rates measured against their own group's median.
 *
 * Totals do not answer a manager's question. "187 calls" only means something
 * next to what the rest of the team did on the same day, and against how long
 * this agent was actually on the clock — an agent who left at noon should not
 * look lazy, and one who stayed late should not look productive by default. So
 * every figure here is a rate over clocked time, compared to the median of the
 * agent's own group.
 *
 * The group split matters: Billing runs outbound collections, where a high
 * outbound share is the job. Tech Support mixes queued calls with follow-ups.
 * One shared median across both would flag correct behaviour as an exception.
 */

import { SAMPLE_AGENTS } from './placeholderData'
import { buildDayModel, fmtHM, type DayModel } from './productivityModel'
import {
  SAMPLE_DATES, getAgentDay, departmentOf, peersIn,
  type Department, type ProductivityRosterRow,
} from './productivitySampleData'

/** How far out of line with the group a figure is. */
export type PeerState = 'inline' | 'watch' | 'off' | 'info'

export interface PeerMetric {
  key: string
  label: string
  /** This agent's value, formatted. */
  value: string
  raw: number
  median: number
  medianLabel: string
  /** The group's spread, so a wide team is not mistaken for an outlier agent. */
  peerMin: number
  peerMax: number
  q1: number
  q3: number
  rangeLabel: string
  state: PeerState
  /** Relative gap against the median: -0.5 means half the team's rate. */
  delta: number | null
  description: string
  /** The actual numbers the rate came from, for the tooltip. */
  basis: string
}

export interface PeerComparison {
  department: Department
  /** Agents in the department, including this one. */
  peerCount: number
  /** False when the department has only this agent — nothing to compare against. */
  comparable: boolean
  metrics: PeerMetric[]
  /** Metrics that are out of line — what the manager should look at first. */
  flagged: PeerMetric[]
}

interface MetricDef {
  key: string
  label: string
  /** `null` for mix indicators that are never scored, only reported. */
  higherIsBetter: boolean | null
  value: (m: DayModel) => number
  format: (v: number) => string
  description: string
  basis: (m: DayModel) => string
}

const hours = (m: DayModel) => Math.max(0.01, m.clockedMin / 60)
const pct = (v: number) => `${Math.round(v)}%`
const rate = (v: number) => v.toFixed(1)

/**
 * Rates over clocked time that the header tiles do not already carry. The header
 * owns the five headline KPIs (utilization, AHT, calls per hour, after-call work,
 * missed); repeating any of them here would put the same number on screen twice.
 */
const DEFS: MetricDef[] = [
  {
    key: 'phone',
    label: 'Phone time',
    higherIsBetter: true,
    value: m => (m.callSummary.handleMins / Math.max(1, m.clockedMin)) * 100,
    format: pct,
    description: 'Share of clocked-in time spent handling calls, including hold and after-call work. The direct answer to "they were here, but were they on the phone?"',
    basis: m => `${fmtHM(m.callSummary.handleMins)} of ${fmtHM(m.clockedMin)} clocked`,
  },
  {
    key: 'tickets',
    label: 'Tickets per hour',
    higherIsBetter: true,
    value: m => m.ticketTotals.total / hours(m),
    format: rate,
    description: 'Ticket and task touches for every hour on the clock. Catches the agent working half the queue of everyone beside them.',
    basis: m => `${m.ticketTotals.total} touches over ${fmtHM(m.clockedMin)}`,
  },
  {
    key: 'transfers',
    label: 'Transfer rate',
    higherIsBetter: false,
    value: m => (m.callSummary.transferred / Math.max(1, m.callSummary.answered)) * 100,
    format: pct,
    description: 'Answered calls passed to another agent or queue instead of being resolved. A rate well above the group usually means a knowledge gap, not a busy day.',
    basis: m => `${m.callSummary.transferred} transferred of ${m.callSummary.answered} answered`,
  },
  {
    key: 'idle',
    label: 'Idle at desk',
    higherIsBetter: false,
    value: m => (m.deskIdleMin / Math.max(1, m.clockedMin)) * 100,
    format: pct,
    description: 'Share of clocked-in time with no computer activity, breaks included. Lower is better, and a figure well above the group is where the missing hours went.',
    basis: m => `${fmtHM(m.deskIdleMin)} of ${fmtHM(m.clockedMin)} clocked`,
  },
  {
    key: 'outbound',
    label: 'Outbound share',
    higherIsBetter: null,
    value: m => (m.callSummary.outbound / Math.max(1, m.callSummary.answered)) * 100,
    format: pct,
    description: 'Outbound share of answered calls. Reported, never scored: collections work should run high here and tech support should not, so the number is only meaningful next to the group.',
    basis: m => `${m.callSummary.outbound} outbound of ${m.callSummary.answered} answered`,
  },
]

/** Linear-interpolated percentile over a sorted copy. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo)
}

export const median = (values: number[]): number => percentile(values, 0.5)

/**
 * Only materially out-of-line figures get a state, so most rows stay neutral and
 * the genuine exception is the thing that catches the eye. Colouring every good
 * value green would defeat the purpose.
 */
export function stateOf(v: number, med: number, higherIsBetter: boolean | null): PeerState {
  if (higherIsBetter === null) return 'info'
  if (med <= 0) return 'inline'
  const ratio = higherIsBetter ? v / med : (v <= 0 ? Infinity : med / v)
  return ratio >= 0.9 ? 'inline' : ratio >= 0.75 ? 'watch' : 'off'
}

/** Worst gap first: a manager should not have to read five rows to find the one. */
const SEVERITY: Record<PeerState, number> = { off: 0, watch: 1, inline: 2, info: 3 }

/**
 * Build the comparison for one agent-day. `self` is passed in rather than rebuilt
 * so the caller's already-computed model is reused.
 *
 * Peer days are generated here from the sample source; in Phase 2 the department
 * medians arrive from the API alongside the agent's own day. A one-person
 * department has no peers, so `comparable` is false and the caller drops the
 * comparison rather than measuring the agent against themselves.
 */
export function buildPeerComparison(agent: string, date: string, self: DayModel): PeerComparison {
  const department = departmentOf(agent)
  const peers = peersIn(department)
  const peerModels = peers.map(p => (p === agent ? self : buildDayModel(getAgentDay(p, date))))

  const metrics: PeerMetric[] = DEFS.map(def => {
    const raw = def.value(self)
    const values = peerModels.map(def.value)
    const med = median(values)
    return {
      key: def.key,
      label: def.label,
      value: def.format(raw),
      raw,
      median: med,
      medianLabel: def.format(med),
      peerMin: Math.min(...values),
      peerMax: Math.max(...values),
      q1: percentile(values, 0.25),
      q3: percentile(values, 0.75),
      rangeLabel: `${def.format(Math.min(...values))} – ${def.format(Math.max(...values))}`,
      state: stateOf(raw, med, def.higherIsBetter),
      delta: med > 0 ? (raw - med) / med : null,
      description: def.description,
      basis: def.basis(self),
    }
  })

  const comparable = peers.length > 1
  return {
    department,
    peerCount: peers.length,
    comparable,
    metrics: [...metrics].sort((a, b) =>
      SEVERITY[a.state] - SEVERITY[b.state] || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)),
    // A solo agent has no one to be out of line with.
    flagged: comparable ? metrics.filter(m => m.state === 'off' || m.state === 'watch') : [],
  }
}

// ── Period roster ────────────────────────────────────────────────────────────

/**
 * One row per agent, summed over the sample days rather than hand-written, so a
 * roster row can never disagree with the drill-down that opens beneath it.
 *
 * Occupancy and Utilization are computed from the summed minutes rather than by
 * averaging each day's percentage — a short day would otherwise carry the same
 * weight as a full one.
 */
export const productivityRoster: ProductivityRosterRow[] = SAMPLE_AGENTS.map(agent => {
  const days = SAMPLE_DATES.map(d => buildDayModel(getAgentDay(agent, d)))
  const total = (f: (m: DayModel) => number) => days.reduce((a, m) => a + f(m), 0)

  const clockedMin = total(m => m.clockedMin)
  const onCallMin = total(m => m.onCallMin)
  const deskWorkMin = total(m => m.deskWorkOffQueueMin)
  const answered = total(m => m.callSummary.answered)
  const handleMin = total(m => m.callSummary.handleMins)

  return {
    agent,
    clockedMin,
    utilizationPct: clockedMin > 0 ? Math.round(((onCallMin + deskWorkMin) / clockedMin) * 100) : 0,
    callsPerHour: clockedMin > 0 ? answered / (clockedMin / 60) : 0,
    ahtMins: answered > 0 ? handleMin / answered : 0,
    missedCalls: total(m => m.callSummary.missed),
  }
})
