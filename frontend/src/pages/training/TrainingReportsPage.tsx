import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import { MessageSquare, TrendingUp, Clock, CheckCircle, RefreshCw } from 'lucide-react'
import trainingService from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ListPagination } from '@/components/common/ListPagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useQualityRole } from '@/hooks/useQualityRole'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TYPE_COLORS: Record<string, string> = {
  WEEKLY_COACHING: '#60a5fa', PERFORMANCE_COACHING: '#fbbf24',
  ESCALATION: '#f87171', SIDE_BY_SIDE: '#2dd4bf', TEAM_SESSION: '#818cf8',
}
const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: '#94a3b8', IN_PROCESS: '#3b82f6', AWAITING_CSR_ACTION: '#f59e0b',
  COMPLETED: '#10b981', FOLLOW_UP_REQUIRED: '#f97316', CLOSED: '#64748b',
}
const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// â”€â”€ Stat Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StatCard({ label, value, icon: Icon, valueClass }: {
  label: string; value: string | number
  icon: React.ComponentType<{ className?: string }>; valueClass?: string
}) {
  return (
    <div className="relative bg-white rounded-xl border border-slate-200 p-5 overflow-hidden">
      <Icon className="h-8 w-8 absolute top-4 right-4 text-slate-900 opacity-10" />
      <p className={cn('text-3xl font-bold text-slate-900', valueClass)}>{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  )
}

// â”€â”€ Chart Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function TrainingReportsPage() {
  const navigate      = useNavigate()
  const { roleId }    = useQualityRole()
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    from: defaultFrom, to: defaultTo, csrs: '', types: '', topics: '', page: '1', size: '20',
  })

  const dateFrom  = get('from')
  const dateTo    = get('to')
  const csrsParam = get('csrs')
  const page      = parseInt(get('page')) || 1
  const pageSize  = parseInt(get('size')) || 20
  const setPage   = (p: number) => set('page', String(p))
  const selectedCsrs   = useMemo(() => csrsParam   ? csrsParam.split(',').filter(Boolean)   : [], [csrsParam])

  const summaryParams = { date_from: dateFrom || undefined, date_to: dateTo || undefined }

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['coaching-reports-summary', dateFrom, dateTo],
    queryFn:  () => trainingService.getReportsSummary(summaryParams),
  })

  const { data: csrListPage, isLoading: csrLoading } = useQuery({
    queryKey: ['coaching-csr-list', page, pageSize, dateFrom, dateTo],
    queryFn:  () => trainingService.getCSRCoachingList({ page, limit: pageSize, ...summaryParams }),
    placeholderData: (p: any) => p,
  })

  // Client-side CSR name filter
  const csrRows = useMemo(() => {
    const items = csrListPage?.items ?? []
    return selectedCsrs.length ? items.filter(r => selectedCsrs.includes(r.csr_name)) : items
  }, [csrListPage?.items, selectedCsrs])

  const csrOptions = useMemo(() => {
    const names = new Set((csrListPage?.items ?? []).map((r: any) => r.csr_name).filter(Boolean))
    return Array.from(names).sort() as string[]
  }, [csrListPage?.items])

  const s = summary ?? {}
  const compRate = Number(s.completion_rate ?? 0)
  const quizRate = Number(s.quiz_pass_rate   ?? 0)

  // Chart data
  const weekData   = (s.sessions_by_week   ?? []).map((r: any) => ({ name: r.week,         count: Number(r.count) }))
  const topicData  = (s.top_topics         ?? []).slice(0, 10).map((r: any) => ({ name: r.topic_name,   count: Number(r.count) }))
  const typeData   = (s.sessions_by_type   ?? []).map((r: any) => ({ name: typeLabel(r.coaching_purpose ?? r.coaching_type), type: r.coaching_purpose ?? r.coaching_type, count: Number(r.count) }))
  const statusData = (s.sessions_by_status ?? []).map((r: any) => ({ name: r.status, count: Number(r.count) }))

  return (
    <QualityListPage>
      <QualityPageHeader title="Training Reports" />

      <QualityFilterBar hasFilters={hasAnyFilter} onReset={reset}
        resultCount={{ total: csrListPage?.total ?? 0 }}>
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={v => setMany({ from: v.start, to: v.end, page: '1' })}
        />
        <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <span className="font-medium text-slate-700">{s.total_sessions ?? 'â€”'}</span> sessions in range
        </div>
      </QualityFilterBar>

      {/* â”€â”€ Stat cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Total Sessions"      value={summaryLoading ? 'â€”' : (s.total_sessions ?? 0)} icon={MessageSquare} />
        <StatCard label="Completion Rate"     value={summaryLoading ? 'â€”' : `${compRate}%`} icon={TrendingUp}
          valueClass={compRate >= 70 ? 'text-emerald-600' : compRate >= 40 ? 'text-amber-600' : 'text-red-600'} />
        <StatCard label="Avg Days to Complete"
          value={summaryLoading ? 'â€”' : s.avg_days_to_completion != null ? `${s.avg_days_to_completion}d` : 'â€”'}
          icon={Clock} />
        <StatCard label="Quiz Pass Rate"      value={summaryLoading ? 'â€”' : `${quizRate}%`} icon={CheckCircle} />
        <StatCard label="Repeat Coaching"     value={summaryLoading ? 'â€”' : `${s.repeat_coaching_rate ?? 0}%`}
          icon={RefreshCw}
          valueClass={(s.repeat_coaching_rate ?? 0) > 20 ? 'text-amber-600' : undefined} />
      </div>

      {/* â”€â”€ Charts 2x2 grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        <ChartCard title="Sessions by Week">
          {weekData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weekData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#00aeef" radius={[3, 3, 0, 0]} name="Sessions" />
                </BarChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Top Topics">
          {topicData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topicData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#00aeef" radius={[0, 3, 3, 0]} name="Sessions" />
                </BarChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Sessions by Type">
          {typeData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={typeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Sessions">
                    {typeData.map((entry, idx) => (
                      <Cell key={idx} fill={TYPE_COLORS[entry.type] ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Status Distribution">
          {statusData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="name" cx="50%" cy="50%"
                    outerRadius={80} label={({ name, percent }) => `${name.replace(/_/g, ' ')} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}>
                    {statusData.map((entry: any, idx: number) => (
                      <Cell key={idx} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [v, 'Sessions']} />
                </PieChart>
              </ResponsiveContainer>
          }
        </ChartCard>

      </div>

      {/* â”€â”€ CSR Drill-Down Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">CSR Breakdown</p>
          {csrOptions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {csrOptions.slice(0, 6).map(name => (
                <button key={name}
                  onClick={() => setMany({ csrs: selectedCsrs.includes(name) ? selectedCsrs.filter(c => c !== name).join(',') : [...selectedCsrs, name].join(','), page: '1' })}
                  className={cn('px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors', selectedCsrs.includes(name) ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        {csrLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <TableHead>CSR</TableHead>
                <TableHead className="text-center">Sessions</TableHead>
                <TableHead className="text-center">Completed</TableHead>
                <TableHead>Completion Rate</TableHead>
                <TableHead className="text-center">Avg Days</TableHead>
                <TableHead className="text-center">Quizzes Passed</TableHead>
                <TableHead>Top Topic</TableHead>
                <TableHead>Last Session</TableHead>
                <TableHead className="w-8" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {csrRows.length === 0 ? (
                <TableEmptyState colSpan={9} icon={MessageSquare} title="No coaching data in this range" />
              ) : csrRows.map((csr: any) => (
                <TableRow key={csr.user_id} className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/training/coaching?csrs=${csr.user_id}`)}>
                  <TableCell className="text-[13px] font-medium text-slate-900">{csr.csr_name}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{csr.total_sessions}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{csr.completed_sessions}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-[60px]">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${csr.completion_rate ?? 0}%` }} />
                      </div>
                      <span className="text-[13px] text-slate-600">{csr.completion_rate ?? 0}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">
                    {csr.avg_days_to_completion != null ? `${csr.avg_days_to_completion}d` : 'â€”'}
                  </TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{csr.quizzes_passed ?? 0}</TableCell>
                  <TableCell className="text-[13px] text-slate-500 max-w-[120px] truncate">{csr.most_common_topic ?? 'â€”'}</TableCell>
                  <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">
                    {csr.last_session_date ? formatQualityDate(csr.last_session_date) : 'â€”'}
                  </TableCell>
                  <TableCell className="text-slate-400 text-[13px]">â†’</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={csrListPage?.totalPages ?? 1}
        totalItems={csrListPage?.total ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => setMany({ size: String(s), page: '1' })}
      />
    </QualityListPage>
  )
}


