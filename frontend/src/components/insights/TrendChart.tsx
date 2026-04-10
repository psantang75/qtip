import { useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts'

interface TrendChartProps {
  data: Array<{ label: string; value: number | null }>
  color: string
  goalValue?: number
  height?: number
  metricLabel?: string
  isPercentage?: boolean
}

export default function TrendChart({
  data,
  color,
  goalValue,
  height = 100,
  metricLabel,
  isPercentage = true,
}: TrendChartProps) {
  const [yMin, yMax] = useMemo(() => {
    const values = data.map(d => d.value).filter((v): v is number => v !== null)
    if (values.length === 0) return [0, isPercentage ? 100 : 10]
    const lo = Math.min(...values, goalValue ?? Infinity)
    const hi = Math.max(...values, goalValue ?? -Infinity)
    const pad = Math.max((hi - lo) * 0.15, 2)
    const yLo = Math.max(0, Math.floor(lo - pad))
    const yHi = Math.ceil(hi + pad)
    return [yLo, isPercentage ? Math.min(100, yHi) : yHi]
  }, [data, goalValue, isPercentage])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          tickCount={5}
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '4px 8px',
          }}
          formatter={(val: number) => [
            `${val.toFixed(1)}${metricLabel ? ` ${metricLabel}` : ''}`,
            'Value',
          ]}
          labelStyle={{ color: '#64748b', fontSize: 10 }}
        />
        {goalValue !== undefined && (
          <ReferenceLine
            y={goalValue}
            stroke="#94a3b8"
            strokeDasharray="4 3"
            label={{ value: 'Goal', position: 'insideTopRight', fontSize: 9, fill: '#94a3b8' }}
          />
        )}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
