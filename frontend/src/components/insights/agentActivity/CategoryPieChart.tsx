import { useRef } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'

/**
 * Auto-rendering category pie chart (e.g. Leads by Source), built on Recharts
 * to match the rest of the Insights charts. Mirrors the legacy Insights pie:
 *   • Full pie (not a donut) with leader-line labels showing "Name: %".
 *   • Any slice under 3% of the total is rolled into a single grey "Other"
 *     slice; the grouped items are still itemized in the "Other" hover tooltip.
 *   • Perimeter "Name: %" labels are vertically de-collided per side so adjacent
 *     small slices never stack on top of each other.
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

// Minimum vertical gap (px) between two perimeter labels on the same side.
const LABEL_GAP = 16
// Horizontal run of the leader line past the elbow, before the text.
const LABEL_ARM = 14

export default function CategoryPieChart({ data, height = 360, unit }: CategoryPieChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0)
  // De-collided label Y per slice index for the current render pass, computed
  // once on the first slice. Spacing all labels together (not one-at-a-time) is
  // what guarantees none overlap. renderLabel reads back its slice's Y.
  const layout = useRef<Map<number, number>>(new Map())

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

  // Compute the de-collided label Y for every slice once (on the first slice).
  // Each label's ideal Y sits just outside its mid-angle; we sort every label on
  // each side top-to-bottom, walk forward (push down to keep LABEL_GAP), then
  // backward (clamp so the stack stays inside the panel). Mirrors Recharts' own
  // angle math (start 0°, counter-clockwise) so indices line up with the slices.
  const buildLayout = (cx: number, cy: number, outerRadius: number): Map<number, number> => {
    const labelR = outerRadius + 18
    const top = 8
    const bottom = 2 * cy - 8

    const items = slices.map((s, i) => {
      const mid = (360 * (slices.slice(0, i).reduce((a, x) => a + x.value, 0) + s.value / 2)) / total
      const sin = Math.sin(-mid * RADIAN)
      const cos = Math.cos(-mid * RADIAN)
      return { i, right: cos >= 0, idealY: cy + labelR * sin, ey: cy + labelR * sin }
    })

    for (const right of [true, false]) {
      const side = items.filter((it) => it.right === right).sort((a, b) => a.idealY - b.idealY)
      let prev = top - LABEL_GAP
      for (const it of side) { it.ey = Math.max(it.idealY, prev + LABEL_GAP); prev = it.ey }
      let next = bottom + LABEL_GAP
      for (let i = side.length - 1; i >= 0; i--) {
        side[i].ey = Math.min(side[i].ey, next - LABEL_GAP)
        next = side[i].ey
      }
    }

    return new Map(items.map((it) => [it.i, it.ey]))
  }

  // Leader-line label: "Name: %", truncated so long source names stay inside the
  // panel. We draw our own elbow leader line (Recharts' default labelLine is off):
  // the start/elbow use the slice's real geometry from props, while the label Y is
  // the de-collided value from buildLayout — so labels never overlap.
  const renderLabel = (props: {
    cx: number; cy: number; midAngle: number; outerRadius: number
    name: string; value: number; index: number
  }) => {
    const { cx, cy, midAngle, outerRadius, name, value, index } = props
    if (index === 0) layout.current = buildLayout(cx, cy, outerRadius)

    const cos = Math.cos(-midAngle * RADIAN)
    const sin = Math.sin(-midAngle * RADIAN)
    const right = cos >= 0
    const sx = cx + outerRadius * cos
    const sy = cy + outerRadius * sin
    const ex = cx + (outerRadius + 18) * cos
    const ey = layout.current.get(index) ?? cy + (outerRadius + 18) * sin
    const tx = ex + (right ? LABEL_ARM : -LABEL_ARM)

    const display = name.length > 24 ? `${name.slice(0, 23)}…` : name
    return (
      <g>
        <polyline
          points={`${sx},${sy} ${ex},${ey} ${tx},${ey}`}
          stroke="#cbd5e1"
          strokeWidth={1}
          fill="none"
        />
        <text
          x={tx + (right ? 3 : -3)}
          y={ey}
          textAnchor={right ? 'start' : 'end'}
          dominantBaseline="central"
          fontSize={11}
          fill="#475569"
        >
          {`${display}: ${pct(value)}%`}
        </text>
      </g>
    )
  }

  const TooltipContent = ({ active, payload }: {
    active?: boolean
    payload?: Array<{ payload: Slice }>
  }) => {
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
        <PieChart margin={{ top: 24, right: 80, bottom: 24, left: 80 }}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="68%"
            stroke="#fff"
            strokeWidth={2}
            isAnimationActive={false}
            label={renderLabel}
            labelLine={false}
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
