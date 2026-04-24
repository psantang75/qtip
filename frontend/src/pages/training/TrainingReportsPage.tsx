import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'
import { MessageSquare, TrendingUp, Clock, CheckCircle, RefreshCw } from 'lucide-react'
import trainingService from '@/services/trainingService'
import { Button } from '@/components/ui/button'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ListPagination } from '@/components/common/ListPagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useQualityRole } from '@/hooks/useQualityRole'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { COACHING_PURPOSE_LABELS, COACHING_STATUS_LABELS, CLIENT_FETCH_LIMIT } from '@/constants/labels'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  WEEKLY:      'var(--color-chart-blue,   #60a5fa)',
  PERFORMANCE: 'var(--color-chart-amber,  #fbbf24)',
  ONBOARDING:  'var(--color-chart-teal,   #2dd4bf)',
}
const STATUS_COLORS: Record<string, string> = {
  DRAFT:               'var(--color-chart-slate,  #94a3b8)',
  SCHEDULED:           'var(--color-chart-indigo, #6366f1)',
  AWAITING_CSR_ACTION: 'var(--color-chart-amber,  #f59e0b)',
  COMPLETED:           'var(--color-chart-green,  #10b981)',
  FOLLOW_UP_REQUIRED:  'var(--color-chart-orange, #f97316)',
  CLOSED:              'var(--color-chart-gray,   #64748b)',
  CANCELED:            'var(--color-chart-red,    #ef4444)',
}
const typeLabel = (t: string) =>
  COACHING_PURPOSE_LABELS[t as keyof typeof COACHING_PURPOSE_LABELS]
  ?? COACHING_STATUS_LABELS[t]
  ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// ── Stat Card (Tremor-styled) ─────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, valueClass, loading }: {
  label: string; value: string | number
  icon: React.ComponentType<{ className?: string }>
  valueClass?: string
  loading?: boolean
}) {
  return (
    <div className="relative bg-white rounded-xl border border-slate-200 p-5 overflow-hidden">
      <Icon className="h-8 w-8 absolute top-4 right-4 text-slate-900 opacity-10" />
      {loading ? (
        <>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-28 mt-2" />
        </>
      ) : (
        <>
          <p className={cn('text-3xl font-bold text-slate-900', valueClass)}>{value}</p>
          <p className="text-sm text-slate-500 mt-1">{label}</p>
        </>
      )}
    </div>
  )
}

// ── Chart Card ────────────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-[15px] font-semibold text-slate-800 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function ChartEmpty() {
  return <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrainingReportsPage() {
  const navigate      = useNavigate()
  useQualityRole() // available for future role-gated features
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    from: defaultFrom, to: defaultTo, agents: '', types: '', topics: '', page: '1', size: '20',
  })

  const dateFrom  = get('from')
  const dateTo    = get('to')
  const agentsParam = get('agents')
  const page      = parseInt(get('page')) || 1
  const pageSize  = parseInt(get('size')) || 20
  const setPage   = (p: number) => set('page', String(p))
  const selectedAgents = useMemo(() => agentsParam ? agentsParam.split(',').filter(Boolean) : [], [agentsParam])

  const summaryParams = { date_from: dateFrom || undefined, date_to: dateTo || undefined }

  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: summaryRefetch } = useQuery({
    queryKey: ['coaching-reports-summary', dateFrom, dateTo],
    queryFn:  () => trainingService.getReportsSummary(summaryParams),
  })

  const { data: agentListPage, isLoading: agentLoading, isError: agentError, refetch: agentRefetch } = useQuery({
    queryKey: ['coaching-agent-list', dateFrom, dateTo],
    queryFn:  () => trainingService.getCSRCoachingList({ page: 1, limit: CLIENT_FETCH_LIMIT, ...summaryParams }),
    placeholderData: (p: unknown) => p as typeof agentListPage,
  })

  const allAgentItems = agentListPage?.items ?? []

  const agentOptions = useMemo(() => {
    const names = new Set(allAgentItems.map(r => r.csr_name).filter(Boolean))
    return Array.from(names).sort() as string[]
  }, [allAgentItems])

  const agentRows = useMemo(() => {
    return selectedAgents.length ? allAgentItems.filter(r => selectedAgents.includes(r.csr_name)) : allAgentItems
  }, [allAgentItems, selectedAgents])

  const agentTotalPages  = Math.max(1, Math.ceil(agentRows.length / pageSize))
  const paginatedAgentRows = agentRows.slice((page - 1) * pageSize, page * pageSize)

  const s = summary ?? {}
  const compRate = Number(s.completion_rate ?? 0)
  const quizRate = Number(s.quiz_pass_rate   ?? 0)

  const weekData = (s.sessions_by_week ?? []).map(
    (r: { week: string; count: number | string }) => ({ name: r.week, count: Number(r.count) })
  )

  const topicData = (s.top_topics ?? []).slice(0, 10).map(
    (r: { topic_name: string; count: number | string }) => ({ name: r.topic_name, count: Number(r.count) })
  )

  const typeData = (s.sessions_by_type ?? []).map(
    (r: { coaching_purpose?: string; coaching_type?: string; count: number | string }) => ({
      name:  typeLabel(r.coaching_purpose ?? r.coaching_type ?? ''),
      type:  r.coaching_purpose ?? r.coaching_type ?? '',
      count: Number(r.count),
    })
  )

  const statusData = (s.sessions_by_status ?? []).map(
    (r: { status: string; count: number | string }) => ({ name: r.status, value: Number(r.count) })
  )


  return (
    <ListPageShell>
      <ListPageHeader title="Training Reports" />

      <ListFilterBar hasFilters={hasAnyFilter} onReset={reset}
        resultCount={{ filtered: agentRows.length, total: allAgentItems.length }}
        truncated={allAgentItems.length >= CLIENT_FETCH_LIMIT}>
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={v => setMany({ from: v.start, to: v.end, page: '1' })}
        />
        <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <span className="font-medium text-slate-700">{s.total_sessions ?? '—'}</span> sessions in range
        </div>
      </ListFilterBar>

      {summaryError && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <TableErrorState message="Failed to load summary metrics." onRetry={summaryRefetch} />
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Total Sessions"      value={s.total_sessions ?? 0} icon={MessageSquare} loading={summaryLoading} />
        <StatCard label="Completion Rate"     value={`${compRate}%`} icon={TrendingUp} loading={summaryLoading}
          valueClass={compRate >= 70 ? 'text-emerald-600' : compRate >= 40 ? 'text-amber-600' : 'text-red-600'} />
        <StatCard label="Avg Days to Complete"
          value={s.avg_days_to_completion != null ? `${s.avg_days_to_completion}d` : '—'}
          icon={Clock} loading={summaryLoading} />
        <StatCard label="Quiz Pass Rate"      value={`${quizRate}%`} icon={CheckCircle} loading={summaryLoading} />
        <StatCard label="Repeat Coaching"     value={`${s.repeat_coaching_rate ?? 0}%`}
          icon={RefreshCw} loading={summaryLoading}
          valueClass={(s.repeat_coaching_rate ?? 0) > 20 ? 'text-amber-600' : undefined} />
      </div>

      {/* ── Charts 2x2 grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        <ChartCard title="Sessions by Week">
          {weekData.length === 0
            ? <ChartEmpty />
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weekData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip />
                  <Bar dataKey="count" name="Sessions" radius={[3, 3, 0, 0]} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Top Topics">
          {topicData.length === 0
            ? <ChartEmpty />
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topicData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Sessions" radius={[0, 3, 3, 0]} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title="Sessions by Type">
          {typeData.length === 0
            ? <ChartEmpty />
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
            ? <ChartEmpty />
            : <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {statusData.map((entry: { name: string }, idx: number) => (
                      <Cell key={idx} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v} sessions`, '']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
          }
        </ChartCard>

      </div>

      {/* ── Agent Drill-Down Table ──────────────────────────────────────────── */}
      <ListCard>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-slate-800">Agent Breakdown</p>
          {agentOptions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {agentOptions.slice(0, 6).map(name => (
                <Button key={name} variant="ghost" size="sm"
                  onClick={() => setMany({ agents: selectedAgents.includes(name) ? selectedAgents.filter(c => c !== name).join(',') : [...selectedAgents, name].join(','), page: '1' })}
                  className={cn('px-2.5 py-0.5 h-auto rounded-full text-[11px] font-medium',
                    selectedAgents.includes(name) ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                  {name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {agentLoading ? (
          <ListLoadingSkeleton rows={8} />
        ) : agentError ? (
          <TableErrorState message="Failed to load coaching data." onRetry={agentRefetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <TableHead>Agent</TableHead>
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
              {paginatedAgentRows.length === 0 ? (
                <TableEmptyState colSpan={9} icon={MessageSquare} title="No coaching data in this range" />
              ) : paginatedAgentRows.map(row => (
                <TableRow key={row.user_id} className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/training/coaching?agents=${row.user_id}`)}>
                  <TableCell className="text-[13px] text-slate-600">{row.csr_name}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{row.total_sessions}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{row.completed_sessions}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-[60px]">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${row.completion_rate ?? 0}%` }} />
                      </div>
                      <span className="text-[13px] text-slate-600">{row.completion_rate ?? 0}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">
                    {row.avg_days_to_completion != null ? `${row.avg_days_to_completion}d` : '—'}
                  </TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{row.quizzes_passed ?? 0}</TableCell>
                  <TableCell className="text-[13px] text-slate-500 max-w-[120px] truncate">{row.most_common_topic ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">
                    {row.last_session_date ? formatQualityDate(row.last_session_date) : '—'}
                  </TableCell>
                  <TableCell className="text-slate-400 text-[13px]">→</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

      <ListPagination
        page={page}
        totalPages={agentTotalPages}
        totalItems={agentRows.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => setMany({ size: String(s), page: '1' })}
      />
    </ListPageShell>
  )
}
