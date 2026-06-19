import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts'

/**
 * Two-line trend chart with independent left/right Y axes. Used by the Agent
 * Activity reports to overlay a total against its per-period average (e.g.
 * Total Calls vs Avg Calls per period) where the two series live on very
 * different scales. Styling mirrors the single-series `TrendChart`.
 */
export interface DualAxisPoint {
  label: string
  left: number
  right: number
}

interface DualAxisTrendChartProps {
  data: DualAxisPoint[]
  leftName: string
  rightName: string
  leftColor?: string
  rightColor?: string
  height?: number
}

export default function DualAxisTrendChart({
  data,
  leftName,
  rightName,
  leftColor = '#00aeef',
  rightColor = '#1abc9c',
  height = 200,
}: DualAxisTrendChartProps) {
  // The two series are often correlated (a total and its per-period average),
  // so on shared 0-based scales they overlap. Offset each axis domain into a
  // distinct vertical band — total rides high, average rides low — so both
  // lines are always visible and clearly separated.
  const band = (vals: number[], placement: 'top' | 'bottom'): [number, number] => {
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const range = hi - lo || Math.max(Math.abs(hi), 1)
    return placement === 'top'
      ? [lo - range * 0.8, hi + range * 0.15]
      : [lo - range * 0.15, hi + range * 0.8]
  }
  const leftDomain  = band(data.map(d => d.left),  'top')
  const rightDomain = band(data.map(d => d.right), 'bottom')

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 4, bottom: 14, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#94a3b8', dy: 8 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="left"
          domain={leftDomain}
          allowDecimals={false}
          tick={{ fontSize: 10, fill: leftColor }}
          tickLine={false}
          axisLine={false}
          tickCount={5}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={rightDomain}
          allowDecimals={false}
          tick={{ fontSize: 10, fill: rightColor }}
          tickLine={false}
          axisLine={false}
          tickCount={5}
        />
        <Tooltip
          contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px' }}
          labelStyle={{ color: '#64748b', fontSize: 10 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        <Line
          yAxisId="left"
          name={leftName}
          type="monotone"
          dataKey="left"
          stroke={leftColor}
          strokeWidth={2}
          dot={{ r: 3, fill: leftColor, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
        <Line
          yAxisId="right"
          name={rightName}
          type="monotone"
          dataKey="right"
          stroke={rightColor}
          strokeWidth={2}
          strokeDasharray="5 3"
          dot={{ r: 3, fill: rightColor, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
