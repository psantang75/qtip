import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { LineChart, Line, ReferenceLine, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import MetricTooltip from './MetricTooltip'
import type { HeaderTile } from './productivityHeader'

/**
 * The KPI strip at the top of the day drill-down: one row of five fixed slots,
 * each carrying its value, the direction it moved over the period, and the figure
 * it is judged against.
 *
 * Fixed slots matter more than they look. When a tile only appeared if it had
 * something to say (missed calls, previously) every agent's header sat in a
 * different place, so the manager re-read the labels on every row they opened.
 *
 * Requires a `TooltipProvider` above it.
 */

const SPARK_W = 76
const SPARK_H = 26

/** Period trend at tile scale: shape only, with the benchmark drawn across it. */
function Sparkline({ series, benchmark }: { series: number[]; benchmark?: number }) {
  if (series.length < 2) return <div style={{ width: SPARK_W, height: SPARK_H }} />

  const data = series.map((value, i) => ({ i, value }))
  // The benchmark has to be inside the domain or its line falls off the chart.
  const withBench = benchmark != null ? [...series, benchmark] : series
  const lo = Math.min(...withBench)
  const hi = Math.max(...withBench)
  const pad = Math.max((hi - lo) * 0.15, 0.5)

  return (
    <LineChart width={SPARK_W} height={SPARK_H} data={data} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
      <YAxis hide domain={[lo - pad, hi + pad]} />
      {benchmark != null && <ReferenceLine y={benchmark} stroke="#cbd5e1" strokeDasharray="2 2" />}
      <Line type="monotone" dataKey="value" stroke="#94a3b8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
    </LineChart>
  )
}

function Tile({ tile }: { tile: HeaderTile }) {
  const Arrow = tile.dir === 'up' ? ArrowUp : tile.dir === 'down' ? ArrowDown : Minus

  return (
    <MetricTooltip {...tile.tip}>
      <div className="h-full cursor-help rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className={cn('text-2xl font-bold leading-none tabular-nums', tile.valueCls)}>{tile.value}</span>
          <Sparkline series={tile.series} benchmark={tile.hasBenchmark ? tile.benchmark : undefined} />
        </div>
        {/* Reserve the row even when empty so a solo department's tiles stay the
            same height as the utilization tile beside them. */}
        <div className="mt-1.5 flex min-h-[16px] items-center gap-1.5 text-[11px]">
          {tile.benchmarkLabel && (
            <>
              <span className="text-slate-500">{tile.benchmarkLabel}</span>
              <span className={cn('ml-auto flex items-center gap-0.5 font-medium tabular-nums', tile.deltaCls)}>
                <Arrow className="h-3 w-3" />
                {tile.deltaLabel}
              </span>
            </>
          )}
        </div>
      </div>
    </MetricTooltip>
  )
}

export default function HeaderMetrics({ tiles }: { tiles: HeaderTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map(t => <Tile key={t.key} tile={t} />)}
    </div>
  )
}
