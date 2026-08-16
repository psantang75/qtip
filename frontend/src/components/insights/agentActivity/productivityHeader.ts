/**
 * The five KPI tiles above the Activity Timeline.
 *
 * A bare number tells a manager nothing: 72% utilization is either recovery or
 * decline, and there is no way to tell from the number alone. So every tile
 * carries three things — the value, the direction it moved over the period, and
 * the figure it is being judged against, drawn on the tile's own face rather than
 * hidden in a tooltip.
 *
 * The five slots are fixed and always render, even at zero, so the header does
 * not reflow as the manager moves between agents.
 *
 * Utilization is the only tile with a target, and the only one allowed to go
 * green: it is the report's headline KPI and the target is a real one. The other
 * four are measured against the agent's own department and stay neutral unless
 * they are materially out of line, because a header where everything is coloured
 * ranks nothing.
 *
 * A one-person department has no median worth drawing, so those four tiles drop
 * their benchmark and delta and show the value and its own trend alone.
 * Utilization keeps its target regardless.
 */

import { buildDayModel, fmtMS, fmtHM, type DayModel } from './productivityModel'
import { SAMPLE_DATES, getAgentDay, departmentOf, peersIn } from './productivitySampleData'
import { median, stateOf, type PeerState } from './productivityBenchmark'
import { METRIC_TEXT, UTILIZATION_TARGET, stateFor } from './productivityStatus'

export interface HeaderTile {
  key: string
  label: string
  value: string
  valueCls: string
  /** Period series for the sparkline, oldest day first. */
  series: number[]
  /** False for a solo department's non-target tiles — no line, no delta. */
  hasBenchmark: boolean
  /** Drawn as a reference line across the sparkline when `hasBenchmark`. */
  benchmark: number
  benchmarkLabel: string
  deltaLabel: string
  deltaCls: string
  dir: 'up' | 'down' | 'flat'
  tip: { title: string; description: string; rows: { label: string; value: string }[] }
}

const VALUE_TEXT: Record<PeerState, string> = {
  inline: 'text-slate-900',
  watch:  'text-warning',
  off:    'text-destructive',
  info:   'text-slate-900',
}

const DELTA_TEXT: Record<PeerState, string> = {
  inline: 'text-slate-400',
  watch:  'text-warning',
  off:    'text-destructive',
  info:   'text-slate-400',
}

const hours = (m: DayModel) => Math.max(0.01, m.clockedMin / 60)

interface TileDef {
  key: string
  label: string
  value: (m: DayModel) => number
  format: (v: number) => string
  /** `false` for AHT, after-call work and missed: high is the exception. */
  higherIsBetter: boolean
  description: string
  rows: (m: DayModel) => { label: string; value: string }[]
}

const DEFS: TileDef[] = [
  {
    key: 'utilization',
    label: 'Utilization',
    value: m => m.utilizationPct,
    format: v => `${Math.round(v)}%`,
    higherIsBetter: true,
    description: 'Share of clocked-in time spent working — on a call, or active at the desk while off queue. Answers whether the paid hours produced work.',
    rows: m => [
      { label: 'On a call', value: fmtHM(m.onCallMin) },
      { label: 'Desk work off queue', value: fmtHM(m.deskWorkOffQueueMin) },
      { label: 'Of clocked time', value: fmtHM(m.clockedMin) },
    ],
  },
  {
    key: 'aht',
    label: 'Handle time',
    value: m => m.callSummary.ahtMins,
    format: fmtMS,
    higherIsBetter: false,
    description: 'Average handle time: talk, hold and after-call work divided by calls answered. The call centre standard for how long one contact costs.',
    rows: m => [
      { label: 'Talk', value: fmtHM(m.callSummary.talkMins) },
      { label: 'Hold', value: fmtHM(m.callSummary.holdMins) },
      { label: 'After-call work', value: fmtHM(m.callSummary.wrapMins) },
      { label: 'Calls answered', value: String(m.callSummary.answered) },
    ],
  },
  {
    key: 'cph',
    label: 'Calls / hr',
    value: m => m.callSummary.answered / hours(m),
    format: v => v.toFixed(1),
    higherIsBetter: true,
    description: 'Calls answered for every hour on the clock. A rate rather than a count, so a short day is compared fairly.',
    rows: m => [
      { label: 'Answered', value: String(m.callSummary.answered) },
      { label: 'Clocked', value: fmtHM(m.clockedMin) },
    ],
  },
  {
    key: 'acw',
    label: 'After-call work',
    value: m => m.callSummary.acwMins,
    format: fmtMS,
    higherIsBetter: false,
    description: 'Average wrap-up time per answered call. The most coachable part of handle time, and the first place a slow day shows up.',
    rows: m => [
      { label: 'Total wrap-up', value: fmtHM(m.callSummary.wrapMins) },
      { label: 'Calls answered', value: String(m.callSummary.answered) },
      { label: 'Share of handle time', value: `${Math.round((m.callSummary.wrapMins / Math.max(1, m.callSummary.handleMins)) * 100)}%` },
    ],
  },
  {
    key: 'missed',
    label: 'Missed',
    value: m => m.callSummary.missed,
    format: v => String(Math.round(v)),
    higherIsBetter: false,
    description: 'Queued calls that alerted this agent and were never answered, leaving the routing status as Not Responding.',
    rows: m => [
      { label: 'No-answer timeouts', value: String(m.notRespondingCount) },
      { label: 'Calls offered', value: String(m.callSummary.total) },
    ],
  },
]

/** Points for utilization (a target), relative percent for the peer medians. */
function delta(def: TileDef, value: number, benchmark: number): { label: string; dir: HeaderTile['dir'] } {
  if (def.key === 'utilization') {
    const pts = Math.round(value - benchmark)
    return { label: pts === 0 ? 'on target' : `${pts > 0 ? '+' : '−'}${Math.abs(pts)} pts`, dir: pts > 0 ? 'up' : pts < 0 ? 'down' : 'flat' }
  }
  if (benchmark <= 0) return { label: '—', dir: 'flat' }
  const p = Math.round(((value - benchmark) / benchmark) * 100)
  return { label: p === 0 ? 'even' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`, dir: p > 0 ? 'up' : p < 0 ? 'down' : 'flat' }
}

/**
 * `self` is the caller's already-built model for the selected day, so the tile
 * values can never disagree with the timeline below them.
 *
 * Phase 2 replaces the two generated sets here — the agent's period series and
 * the group medians — with a single API response.
 */
export function buildHeaderTiles(agent: string, date: string, self: DayModel): HeaderTile[] {
  const department = departmentOf(agent)
  const peers = peersIn(department)
  const comparable = peers.length > 1
  const peerModels = peers.map(p => (p === agent ? self : buildDayModel(getAgentDay(p, date))))
  const periodModels = SAMPLE_DATES.map(d => (d === date ? self : buildDayModel(getAgentDay(agent, d))))

  return DEFS.map(def => {
    const value = def.value(self)
    const isTarget = def.key === 'utilization'
    const hasBenchmark = isTarget || comparable
    const benchmark = isTarget ? UTILIZATION_TARGET.good : median(peerModels.map(def.value))
    const state = isTarget ? 'inline' : comparable ? stateOf(value, benchmark, def.higherIsBetter) : 'inline'
    const d = delta(def, value, benchmark)

    return {
      key: def.key,
      label: def.label,
      value: def.format(value),
      valueCls: isTarget ? METRIC_TEXT[stateFor(value, UTILIZATION_TARGET)] : VALUE_TEXT[state],
      series: periodModels.map(def.value),
      hasBenchmark,
      benchmark,
      benchmarkLabel: !hasBenchmark ? '' : isTarget ? `target ${def.format(benchmark)}` : `dept ${def.format(benchmark)}`,
      deltaLabel: hasBenchmark ? d.label : '',
      deltaCls: isTarget ? METRIC_TEXT[stateFor(value, UTILIZATION_TARGET)] : DELTA_TEXT[state],
      dir: d.dir,
      tip: {
        title: def.label,
        description: def.description,
        rows: [
          ...def.rows(self),
          ...(hasBenchmark ? [{ label: isTarget ? 'Target' : `${department} median`, value: def.format(benchmark) }] : []),
        ],
      },
    }
  })
}
