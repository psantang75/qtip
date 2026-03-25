import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { BarChart3, RefreshCw, Filter, FileBarChart } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'

type Preset = '7d' | '30d' | '90d' | 'mtd' | 'qtd' | 'ytd' | 'custom'

function getPresetDates(preset: Preset): { start: string; end: string } {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const sub = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d }
  switch (preset) {
    case '7d':  return { start: fmt(sub(7)),  end: fmt(today) }
    case '30d': return { start: fmt(sub(30)), end: fmt(today) }
    case '90d': return { start: fmt(sub(90)), end: fmt(today) }
    case 'mtd': return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) }
    case 'qtd': return { start: fmt(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)), end: fmt(today) }
    case 'ytd': return { start: `${today.getFullYear()}-01-01`, end: fmt(today) }
    default:    return { start: fmt(sub(30)), end: fmt(today) }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' }, { value: 'mtd', label: 'Month to date' },
  { value: 'qtd', label: 'Quarter to date' }, { value: 'ytd', label: 'Year to date' },
  { value: 'custom', label: 'Custom range' },
]

function TrendsChart({ data }: { data: any }) {
  const chartData = data?.labels?.map((l: string, i: number) => ({ name: l, score: data.datasets?.[0]?.data?.[i] ?? 0 })) ?? []
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

function AveragesChart({ data }: { data: any }) {
  const chartData = data?.labels?.map((l: string, i: number) => ({ name: l, score: data.datasets?.[0]?.data?.[i] ?? 0 })) ?? []
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

function RawScoresTable({ data }: { data: any }) {
  if (!data?.labels?.length) return <p className="text-slate-400 text-sm py-4 text-center">No data.</p>
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="bg-slate-50 border-b border-slate-200">
            <TableHead>Name</TableHead>
            {data.datasets?.map((ds: any) => <TableHead key={ds.name} className="text-right">{ds.name}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {data.labels.map((l: string, i: number) => (
              <TableRow key={l} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium text-slate-900">{l}</TableCell>
                {data.datasets?.map((ds: any) => (
                  <TableCell key={ds.name} className="text-right text-[13px] text-slate-600">
                    {typeof ds.data[i] === 'number' ? `${ds.data[i].toFixed(1)}%` : ds.data[i] ?? '—'}
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

function SummaryCards({ data }: { data: any }) {
  if (!data?.summary) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Object.entries(data.summary).map(([k, v]) => (
        <div key={k} className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">{k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</p>
          <p className="text-2xl font-bold text-slate-900">
            {typeof v === 'number' && k.toLowerCase().includes('score') ? `${(v as number).toFixed(1)}%` : String(v)}
          </p>
        </div>
      ))}
    </div>
  )
}

export default function QualityAnalyticsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const roleId = user?.role_id ?? 0
  const isManager = roleId === 5

  const [preset, setPreset] = useState<Preset>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [reportType, setReportType] = useState<'trends' | 'averages' | 'raw_scores' | 'summary'>('trends')
  const [groupBy, setGroupBy] = useState<'csr' | 'department' | 'form'>('csr')
  const [aggregation, setAggregation] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [departmentId, setDepartmentId] = useState('all')
  const [csrId, setCsrId] = useState('all')
  const [formId, setFormId] = useState('all')
  const [runKey, setRunKey] = useState(0)

  const dates = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd }
    return getPresetDates(preset)
  }, [preset, customStart, customEnd])

  const { data: filterOptions } = useQuery({
    queryKey: ['analytics-filters'],
    queryFn: () => qaService.getAnalyticsFilters(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: teamCSRs } = useQuery({
    queryKey: ['team-csrs'],
    queryFn: () => qaService.getTeamCSRs(),
    enabled: isManager,
  })

  const { data: forms } = useQuery({
    queryKey: ['forms-filter'],
    queryFn: () => qaService.getFormsForFilter(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: report, isLoading: reportLoading, isError: reportError } = useQuery({
    queryKey: ['analytics-report', runKey, dates, reportType, groupBy, aggregation, departmentId, csrId, formId],
    queryFn: () => qaService.getComprehensiveReport({
      report_type: reportType, start_date: dates.start, end_date: dates.end,
      department_id: departmentId !== 'all' ? parseInt(departmentId) : undefined,
      csr_id: csrId !== 'all' ? parseInt(csrId) : undefined,
      form_id: formId !== 'all' ? parseInt(formId) : undefined,
      group_by: groupBy, aggregation,
    }),
    enabled: runKey > 0 && !!dates.start && !!dates.end,
  })

  const runReport = () => {
    if (!dates.start || !dates.end) { toast({ title: 'Date required', description: 'Please select a date range.', variant: 'destructive' }); return }
    setRunKey(k => k + 1)
  }

  if (roleId !== 1 && roleId !== 2 && roleId !== 5) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">QA Analytics is not available for your role.</div>
      </div>
    )
  }

  const csrOptions = isManager
    ? (teamCSRs ?? [])
    : (filterOptions?.csrs?.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })) ?? [])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">QA Analytics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Comprehensive quality reporting</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
          <Filter className="h-4 w-4" /> Report Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Date Range</Label>
            <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{PRESETS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {preset === 'custom' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Report Type</Label>
            <Select value={reportType} onValueChange={v => setReportType(v as typeof reportType)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="trends">Score Trends</SelectItem>
                <SelectItem value="averages">Averages</SelectItem>
                <SelectItem value="raw_scores">Raw Scores</SelectItem>
                <SelectItem value="summary">Summary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(reportType === 'trends' || reportType === 'averages') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Group By</Label>
              <Select value={groupBy} onValueChange={v => setGroupBy(v as typeof groupBy)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csr">CSR</SelectItem>
                  {!isManager && <SelectItem value="department">Department</SelectItem>}
                  <SelectItem value="form">Form</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {reportType === 'trends' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Aggregation</Label>
              <Select value={aggregation} onValueChange={v => setAggregation(v as typeof aggregation)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!isManager && filterOptions?.departments && (
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {filterOptions.departments.map((d: { id: number; name: string }) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {csrOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">CSR</Label>
              <Select value={csrId} onValueChange={setCsrId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All CSRs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All CSRs</SelectItem>
                  {csrOptions.map((c: { id: number; name: string }) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {forms && forms.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Form</Label>
              <Select value={formId} onValueChange={setFormId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All forms" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All forms</SelectItem>
                  {forms.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.form_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="pt-2">
          <Button onClick={runReport} disabled={reportLoading} className="bg-primary hover:bg-primary/90 text-white">
            {reportLoading ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running...</> : <><BarChart3 className="h-4 w-4 mr-2" />Run Report</>}
          </Button>
        </div>
      </div>

      {runKey === 0 && (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl py-16 text-center text-slate-400">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">Configure filters and click Run Report</p>
          <p className="text-sm mt-1">Results will appear here</p>
        </div>
      )}

      {reportLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <RefreshCw className="h-8 w-8 mx-auto mb-3 text-primary animate-spin" />
          <p className="text-slate-500 text-sm">Generating report...</p>
        </div>
      )}

      {reportError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between">
          <p className="text-red-700 font-medium text-sm">Failed to generate report.</p>
          <Button variant="outline" size="sm" onClick={runReport}><RefreshCw className="h-4 w-4 mr-1" /> Retry</Button>
        </div>
      )}

      {report && !reportLoading && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
            <FileBarChart className="h-4 w-4 text-primary" />
            <span className="font-semibold text-slate-800 text-sm">
              {reportType === 'trends' && 'Score Trends'}
              {reportType === 'averages' && 'Average Scores'}
              {reportType === 'raw_scores' && 'Raw Score Data'}
              {reportType === 'summary' && 'Summary'}
            </span>
            <span className="text-xs text-slate-400 ml-1">{dates.start} — {dates.end}</span>
          </div>
          <div className="p-5 space-y-6">
            {report.summary && <SummaryCards data={report} />}
            {reportType === 'trends'   && <TrendsChart data={report} />}
            {reportType === 'averages' && <AveragesChart data={report} />}
            {(reportType === 'raw_scores' || reportType === 'averages' || reportType === 'trends') && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Data Table</p>
                <RawScoresTable data={report} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
