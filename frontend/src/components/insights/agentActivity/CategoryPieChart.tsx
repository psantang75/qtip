import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'

/**
 * Auto-rendering category pie chart (e.g. Leads by Source), built on Recharts
 * to match the rest of the Insights charts. Mirrors the legacy Insights pie:
 *   • Full pie (not a donut) with leader-line labels showing "Name: %".
 *   • Any slice under 3% of the total is rolled into a single grey "Other"
 *     slice so perimeter labels never collide.
 *   • Hover shows "Name: count (%)"; hovering "Other" lists every grouped item.
 * Sized to fit a half-screen panel.
 */
export interface PieSlice { name: string; value: number }
interface Slice extends PieSlice { breakdown?: PieSlice[] }

// QTIP brand palette + supporting accents, cycled across slices.
const PALETTE = ['#00aeef', '#1abc9c', '#f39c12', '#e74c3c', '#6366f1', '#0ea5e9', '#14b8a6', '#a855f7', '#ec4899', '#84cc16']
const OTHER_COLOR = '#94a3b8'
const SMALL_SLICE_THRESHOLD = 0.03 // slices below 3% get grouped into "Other"
const RADIAN = Math.PI / 180

interface CategoryPieChartProps {
  data: PieSlice[]
  height?: number
  /** Suffix used in the tooltip value (e.g. "leads"). */
  unit?: string
}

export default function CategoryPieChart({ data, height = 360, unit }: CategoryPieChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0)

  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-slate-400" style={{ height }}>
        No data for the current filters.
      </div>
    )
  }

  // Sort descending, then roll everything under the threshold into "Other".
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const big   = sorted.filter(d => d.value / total >= SMALL_SLICE_THRESHOLD)
  const small = sorted.filter(d => d.value / total < SMALL_SLICE_THRESHOLD)
  const slices: Slice[] = [...big]
  if (small.length > 0) {
    slices.push({ name: 'Other', value: small.reduce((s, d) => s + d.value, 0), breakdown: small })
  }

  const colorFor = (slice: Slice, i: number) => (slice.name === 'Other' ? OTHER_COLOR : PALETTE[i % PALETTE.length])
  const fmtVal   = (v: number) => `${v.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`
  const pct      = (v: number) => ((v / total) * 100).toFixed(1)

  // Leader-line label: "Name: %", truncated so long source names stay inside the panel.
  const renderLabel = (props: any) => {
    const { cx, cy, midAngle, outerRadius, name, value } = props
    const r = outerRadius + 16
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    const display = name.length > 24 ? `${name.slice(0, 23)}…` : name
    return (
      <text
        x={x}
        y={y}
        textAnchor={x >= cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={11}
        fill="#475569"
      >
        {`${display}: ${pct(value)}%`}
      </text>
    )
  }

  const TooltipContent = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const slice: Slice = payload[0].payload
    return (
      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] shadow-sm max-w-[280px]">
        <div className="font-semibold text-slate-800">
          {slice.name}: {fmtVal(slice.value)} ({pct(slice.value)}%)
        </div>
        {slice.name === 'Other' && slice.breakdown && (
          <div className="mt-1.5">
            <div className="mb-1 font-medium text-slate-500">Breakdown ({slice.breakdown.length} items):</div>
            <ul className="max-h-[180px] overflow-y-auto space-y-0.5">
              {slice.breakdown.map(item => (
                <li key={item.name} className="flex items-start justify-between gap-3 text-slate-600">
                  <span className="break-words">{item.name}:</span>
                  <span className="shrink-0 tabular-nums">{fmtVal(item.value)} ({pct(item.value)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[640px]" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 12, right: 80, bottom: 12, left: 80 }}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="72%"
            stroke="#fff"
            strokeWidth={2}
            isAnimationActive={false}
            label={renderLabel}
            labelLine={{ stroke: '#cbd5e1' }}
          >
            {slices.map((slice, i) => (
              <Cell key={slice.name} fill={colorFor(slice, i)} />
            ))}
          </Pie>
          <Tooltip content={<TooltipContent />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
