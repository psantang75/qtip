import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'

/** Map a chart-API response (labels + datasets[0].data) to recharts-compatible array */
export function toChartData(data: ChartData): { name: string; score: number }[] {
  return data?.labels?.map((l, i) => ({ name: l, score: data.datasets?.[0]?.data?.[i] ?? 0 })) ?? []
}

export interface ChartData {
  labels?: string[]
  datasets?: { name: string; data: (number | null)[] }[]
}

export function TrendsChart({ data }: { data: ChartData }) {
  const chartData = toChartData(data)
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Avg Score']} />
        <Line type="monotone" dataKey="score" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function AveragesChart({ data }: { data: ChartData }) {
  const chartData = toChartData(data)
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Avg Score']} />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} fill="var(--color-primary)"
          label={{ position: 'right' as const, formatter: (v: number) => `${v.toFixed(1)}%`, fontSize: 11 }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RawScoresTable({ data }: { data: ChartData }) {
  if (!data?.labels?.length) return <p className="text-slate-400 text-sm py-4 text-center">No data.</p>
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <StandardTableHeaderRow>
              <TableHead>Name</TableHead>
              {data.datasets?.map(ds => <TableHead key={ds.name} className="text-right">{ds.name}</TableHead>)}
            </StandardTableHeaderRow>
          </TableHeader>
          <TableBody>
            {data.labels.map((l, i) => (
              <TableRow key={l} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium text-slate-900">{l}</TableCell>
                {data.datasets?.map(ds => (
                  <TableCell key={ds.name} className="text-right text-[13px] text-slate-600">
                    {typeof ds.data[i] === 'number' ? `${(ds.data[i] as number).toFixed(1)}%` : ds.data[i] ?? '—'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
