import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { cn } from '@/lib/utils'
import { formatQualityDate } from '@/utils/dateFormat'
import type { TicketDailyPoint, TicketHistoryParams } from '@/services/insightsService'

/**
 * Three-line trend of the daily 8am Tickets & Tasks snapshot (Current / Due
 * Today / Past Due), shared by the Sales and CSR sections the same way
 * TicketsTasksTable is. The page passes the section's fetch function and the
 * live filter params, so the trend always aggregates exactly the population
 * the table above it shows (SELF scope folds in server-side). Styling mirrors
 * DualAxisTrendChart; series colors are the QTIP brand palette.
 */

const RANGES = [
  { key: '30',  label: '30 Days',  days: 30 },
  { key: '90',  label: '90 Days',  days: 90 },
  { key: '365', label: '1 Year',   days: 365 },
  { key: 'all', label: 'All',      days: null },
] as const

type RangeKey = (typeof RANGES)[number]['key']

// Same pill style as the canonical optionCls pattern in formRendererComponents.
const pillCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]'

const SERIES = [
  { dataKey: 'current',  name: 'Current',   color: '#00aeef' },
  { dataKey: 'dueToday', name: 'Due Today', color: '#f39c12' },
  { dataKey: 'pastDue',  name: 'Past Due',  color: '#e74c3c' },
] as const

interface TicketsTasksTrendProps {
  /** Distinct per section so Sales and CSR caches never collide. */
  queryKey: string
  fetchHistory: (p: TicketHistoryParams) => Promise<TicketDailyPoint[]>
  /** The page's live filter params (CSV strings from useActivityFilters). */
  params: TicketHistoryParams
  height?: number
}

export default function TicketsTasksTrend({
  queryKey,
  fetchHistory,
  params,
  height = 240,
}: TicketsTasksTrendProps) {
  const [range, setRange] = useState<RangeKey>('90')

  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKey, params.users, params.departments],
    queryFn:  () => fetchHistory({ users: params.users, departments: params.departments }),
  })

  const points = useMemo(() => {
    const all = data ?? []
    const days = RANGES.find((r) => r.key === range)?.days ?? null
    const sliced = days === null ? all : all.slice(-days)
    return sliced.map((p) => {
      // YYYY-MM-DD -> M/D axis label; parse pieces directly (never new Date(str))
      // per the local-first date-handling convention.
      const [, m, d] = p.date.split('-')
      return { ...p, label: `${Number(m)}/${Number(d)}` }
    })
  }, [data, range])

  if (isLoading) {
    return <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
  }
  if (isError) {
    return <p className="text-sm text-danger text-center py-6">Couldn't load the trend. Refresh to try again.</p>
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-slate-400 text-center py-6">
        No snapshot history yet — the first daily capture appears the morning after this report goes live.
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-1 mb-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all', pillCls(range === r.key))}
          >
            {r.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 14, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#94a3b8', dy: 8 }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickCount={5}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px' }}
            labelStyle={{ color: '#64748b', fontSize: 10 }}
            labelFormatter={(_, payload) => formatQualityDate(payload?.[0]?.payload?.date)}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
          {SERIES.map((s) => (
            <Line
              key={s.dataKey}
              name={s.name}
              type="monotone"
              dataKey={s.dataKey}
              stroke={s.color}
              strokeWidth={2}
              dot={points.length <= 90 ? { r: 3, fill: s.color, strokeWidth: 0 } : false}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
