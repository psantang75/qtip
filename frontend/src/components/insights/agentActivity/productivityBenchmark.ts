/**
 * Places one agent's day inside the spread of the people doing the same job.
 *
 * Totals do not answer a manager's question. "187 calls" only means something
 * next to what the rest of the team did on the same day, and against how long the
 * agent was actually on the clock. So every figure here is measured against the
 * median of the agent's own department, computed from the same single-day roster
 * the table above is built from — a comparison never crosses departments (Billing
 * runs outbound, Tech Support mixes queued calls with follow-ups; one shared
 * median would flag correct behaviour as an exception).
 */

import { fmtHM } from './productivityModel'
import type { ProductivityRosterRow } from './productivityTypes'

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
  department: string
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
  value: (r: ProductivityRosterRow) => number
  format: (v: number) => string
  description: string
  basis: (r: ProductivityRosterRow) => string
}

const count = (v: number) => String(Math.round(v))
const percent = (v: number) => `${Math.round(v)}%`

/**
 * Day figures for this agent, each placed inside the spread of the people doing
 * the same job. All four are sourced live from the same day the roster is built
 * from, so the comparison always reconciles with the row it opens beneath.
 */
const DEFS: MetricDef[] = [
  {
    key: 'phone',
    label: 'Total Phone Time',
    higherIsBetter: true,
    value: r => r.handleMin,
    format: fmtHM,
    description: 'Total time handling calls for the day, including talk, hold, and after-call work.',
    basis: r => `${fmtHM(r.handleMin)} of ${fmtHM(r.clockedMin)} paid`,
  },
  {
    key: 'queue',
    label: 'Total Time in Queue',
    higherIsBetter: null,
    value: r => r.onQueueMin,
    format: fmtHM,
    description: 'Total time signed in and available to the call queue for the day.',
    basis: r => `${fmtHM(r.onQueueMin)} of ${fmtHM(r.clockedMin)} paid`,
  },
  {
    key: 'tickets',
    label: 'Tickets Touched',
    higherIsBetter: true,
    value: r => r.ticketsTouched,
    format: count,
    description: 'Tickets and tasks the agent updated or closed during the day — the same touch basis as the Workload report.',
    basis: r => `${r.ticketsTouched} touched`,
  },
  {
    key: 'occupancy',
    label: 'Occupancy',
    higherIsBetter: true,
    value: r => r.occupancyPct,
    format: percent,
    description: 'Engaged share of time in queue — how busy the agent was while signed in and available.',
    basis: r => `${Math.round(r.occupancyPct)}% engaged of ${fmtHM(r.onQueueMin)} in queue`,
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
 * Build the comparison for one agent against their department, from the day
 * roster. A one-person department has no peers, so `comparable` is false and the
 * caller drops the comparison rather than measuring the agent against themselves.
 */
export function buildPeerComparison(agent: string, roster: ProductivityRosterRow[]): PeerComparison {
  const self = roster.find(r => r.agent === agent)
  const department = self?.department ?? ''
  const peers = roster.filter(r => r.department === department)

  const metrics: PeerMetric[] = DEFS.map(def => {
    const raw = self ? def.value(self) : 0
    const values = peers.map(def.value)
    const med = median(values)
    return {
      key: def.key,
      label: def.label,
      value: def.format(raw),
      raw,
      median: med,
      medianLabel: def.format(med),
      peerMin: values.length ? Math.min(...values) : 0,
      peerMax: values.length ? Math.max(...values) : 0,
      q1: percentile(values, 0.25),
      q3: percentile(values, 0.75),
      rangeLabel: `${def.format(values.length ? Math.min(...values) : 0)} – ${def.format(values.length ? Math.max(...values) : 0)}`,
      state: stateOf(raw, med, def.higherIsBetter),
      delta: med > 0 ? (raw - med) / med : null,
      description: def.description,
      basis: self ? def.basis(self) : '',
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
