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
  getAgentDay, departmentOf, peersIn,
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

const count = (v: number) => String(Math.round(v))

/**
 * Day totals for this agent, each placed inside the spread of the people doing
 * the same job. These are absolute figures (hours, or a count for tickets) rather
 * than rates, so the strip compares "how much" directly across the department.
 */
const DEFS: MetricDef[] = [
  {
    key: 'phone',
    label: 'Total Phone Time',
    higherIsBetter: true,
    value: m => m.callSummary.handleMins,
    format: fmtHM,
    description: 'Total time handling calls for the day, including talk, hold, and after-call work.',
    basis: m => `${fmtHM(m.callSummary.handleMins)} of ${fmtHM(m.clockedMin)} paid`,
  },
  {
    key: 'queue',
    label: 'Total Time in Queue',
    higherIsBetter: null,
    value: m => m.onQueueMin,
    format: fmtHM,
    description: 'Total time signed in and available to the call queue for the day.',
    basis: m => `${fmtHM(m.onQueueMin)} of ${fmtHM(m.clockedMin)} paid`,
  },
  {
    key: 'tickets',
    label: 'Tickets Touched',
    higherIsBetter: true,
    value: m => m.ticketTotals.total,
    format: count,
    description: 'Tickets and tasks the agent updated or closed during the day.',
    basis: m => `${m.ticketTotals.total} touched · ${m.ticketTotals.completed} closed`,
  },
  {
    key: 'productive',
    label: 'Total Productive Time',
    higherIsBetter: true,
    value: m => m.onCallMin + m.deskWorkOffQueueMin,
    format: fmtHM,
    description: 'Time on calls plus active desk work done off the queue — the productive share of paid time.',
    basis: m => `${fmtHM(m.onCallMin + m.deskWorkOffQueueMin)} of ${fmtHM(m.clockedMin)} paid`,
  },
  {
    key: 'idle',
    label: 'Total Idle Time',
    higherIsBetter: false,
    value: m => m.deskIdleMin,
    format: fmtHM,
    description: 'Total paid time with no computer activity. Lower is better; a figure well above the group is where the missing hours went.',
    basis: m => `${fmtHM(m.deskIdleMin)} of ${fmtHM(m.clockedMin)} paid`,
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
    // Rendered in the fixed list order so the rows never reshuffle between agents.
    metrics,
    // The banner still surfaces the worst gaps first — that ranking is only used
    // there, not in the row list.
    flagged: comparable
      ? metrics
          .filter(m => m.state === 'off' || m.state === 'watch')
          .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
      : [],
  }
}

// ── Single-day roster ────────────────────────────────────────────────────────

/**
 * One row per agent for a single day, built from the same `buildDayModel` the
 * drill-down uses, so a collapsed roster row can never disagree with the tiles
 * that open beneath it — both describe the same day.
 *
 * The report is day-scoped (driven by the filter bar's single-day Period
 * selector), which is why this takes a date rather than summing a period: the
 * old period roll-up put a different number in the row than in the drill-down.
 */
export function rosterForDate(date: string): ProductivityRosterRow[] {
  return SAMPLE_AGENTS.map(agent => {
    const m: DayModel = buildDayModel(getAgentDay(agent, date))
    return {
      agent,
      clockedMin: m.clockedMin,
      utilizationPct: m.utilizationPct,
      callsPerHour: m.clockedMin > 0 ? m.callSummary.answered / (m.clockedMin / 60) : 0,
      ahtMins: m.callSummary.ahtMins,
      missedCalls: m.callSummary.missed,
    }
  })
}
