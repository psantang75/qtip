import { cn } from '@/lib/utils'
import MetricTooltip from './MetricTooltip'
import type { PeerComparison, PeerMetric, PeerState } from './productivityBenchmark'

/**
 * "Versus the group" — each rate over clocked time, placed inside the spread of
 * the people doing the same job.
 *
 * The bar is a distribution strip, not a progress bar. A single median tick could
 * not distinguish an agent who is genuinely adrift from a team that is simply
 * spread out, which are opposite management problems: the pale band is the
 * group's full range, the darker band its middle half, and the dot is this agent.
 * Two agents can both sit 20% below the median and only one of them be outside
 * what the team normally does.
 *
 * Rows arrive sorted worst-gap-first from `buildPeerComparison`.
 *
 * Requires a `TooltipProvider` above it.
 */

const DOT: Record<PeerState, string> = {
  inline: 'bg-primary',
  watch:  'bg-warning',
  off:    'bg-destructive',
  info:   'bg-slate-400',
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

const ROW = 'grid grid-cols-[minmax(0,1fr)_auto_minmax(48px,0.9fr)_44px] items-center gap-2'

function fmtDelta(d: number | null): string {
  if (d === null) return '—'
  const p = Math.round(d * 100)
  if (p === 0) return 'even'
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`
}

function Strip({ m }: { m: PeerMetric }) {
  // Scaled to the group's range plus the agent, so the strip always contains
  // both and an agent outside the team's range reads as outside it.
  const lo = Math.min(m.peerMin, m.raw)
  const hi = Math.max(m.peerMax, m.raw)
  const span = hi - lo || 1
  const at = (v: number) => ((v - lo) / span) * 100

  return (
    <div className="relative h-1.5">
      <div className="absolute inset-y-0 rounded-full bg-slate-100" style={{ left: `${at(m.peerMin)}%`, right: `${100 - at(m.peerMax)}%` }} />
      <div className="absolute inset-y-0 rounded-full bg-slate-200" style={{ left: `${at(m.q1)}%`, right: `${100 - at(m.q3)}%` }} />
      <div className="absolute -inset-y-1 w-px bg-slate-400" style={{ left: `${at(m.median)}%` }} />
      <div
        className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white', DOT[m.state])}
        style={{ left: `${at(m.raw)}%` }}
      />
    </div>
  )
}

function MetricRow({ m, department }: { m: PeerMetric; department: string }) {
  return (
    <MetricTooltip
      title={m.label}
      description={m.description}
      rows={[
        { label: 'This agent', value: m.value },
        { label: `${department} median`, value: m.medianLabel },
        { label: 'Department range', value: m.rangeLabel },
        { label: 'Basis', value: m.basis },
      ]}
    >
      <div className={cn(ROW, 'cursor-help')}>
        <span className="truncate text-[12.5px] text-slate-600">{m.label}</span>
        <span className={cn('whitespace-nowrap text-right text-[12.5px] font-semibold tabular-nums', VALUE_TEXT[m.state])}>{m.value}</span>
        <Strip m={m} />
        <span className={cn('text-right text-[11px] font-medium tabular-nums', DELTA_TEXT[m.state])}>{fmtDelta(m.delta)}</span>
      </div>
    </MetricTooltip>
  )
}

export default function PeerCompareColumn({ cmp }: { cmp: PeerComparison }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Department Comparison</div>
      <div className="space-y-2">
        {cmp.metrics.map(m => <MetricRow key={m.key} m={m} department={cmp.department} />)}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-slate-200" /> Middle Half of the Department</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-slate-400" /> Median</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white" /> This Agent</span>
      </div>
    </div>
  )
}
