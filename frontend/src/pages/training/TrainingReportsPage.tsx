import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BarChart, DonutChart } from '@tremor/react'
import {
  BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { MessageSquare, TrendingUp, Clock, CheckCircle, RefreshCw } from 'lucide-react'
import trainingService from '@/services/trainingService'
import { Button } from '@/components/ui/button'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ListPagination } from '@/components/common/ListPagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useQualityRole } from '@/hooks/useQualityRole'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { COACHING_PURPOSE_LABELS, COACHING_STATUS_LABELS } from '@/constants/labels'

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
}
const typeLabel = (t: string) =>
  COACHING_PURPOSE_LABELS[t as keyof typeof COACHING_PURPOSE_LABELS]
  ?? COACHING_STATUS_LABELS[t]
  ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// ── Stat Card (Tremor-styled) ─────────────────────────────────────────────────

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

// ── Chart Card ────────────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-[15px] font-semibold text-slate-800 mb-4">{title}</h3>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrainingReportsPage() {
  const navigate      = useNavigate()
  useQualityRole() // available for future role-gated features
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
  const selectedCsrs = useMemo(() => csrsParam ? csrsParam.split(',').filter(Boolean) : [], [csrsParam])

  const summaryParams = { date_from: dateFrom || undefined, date_to: dateTo || undefined }

  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: summaryRefetch } = useQuery({
    queryKey: ['coaching-reports-summary', dateFrom, dateTo],
    queryFn:  () => trainingService.getReportsSummary(summaryParams),
  })

  const { data: csrListPage, isLoading: csrLoading, isError: csrError, refetch: csrRefetch } = useQuery({
    queryKey: ['coaching-csr-list', page, pageSize, dateFrom, dateTo],
    queryFn:  () => trainingService.getCSRCoachingList({ page, limit: pageSize, ...summaryParams }),
    placeholderData: (p: unknown) => p as typeof csrListPage,
  })

  const csrRows = useMemo(() => {
    const items = csrListPage?.items ?? []
    return selectedCsrs.length ? items.filter(r => selectedCsrs.includes(r.csr_name)) : items
  }, [csrListPage?.items, selectedCsrs])

  const csrOptions = useMemo(() => {
    const names = new Set((csrListPage?.items ?? []).map(r => r.csr_name).filter(Boolean))
    return Array.from(names).sort() as string[]
  }, [csrListPage?.items])

  const s = summary ?? {}
  const compRate = Number(s.completion_rate ?? 0)
  const quizRate = Number(s.quiz_pass_rate   ?? 0)

  // Tremor BarChart data: sessions by week
  const weekData = (s.sessions_by_week ?? []).map(
    (r: { week: string; count: number | string }) => ({ Week: r.week, Sessions: Number(r.count) })
  )

  // Tremor BarChart data: top topics (horizontal)
  const topicData = (s.top_topics ?? []).slice(0, 10).map(
    (r: { topic_name: string; count: number | string }) => ({ Topic: r.topic_name, Sessions: Number(r.count) })
  )

  // Recharts data for multi-color bars (Sessions by Type)
  const typeData = (s.sessions_by_type ?? []).map(
    (r: { coaching_purpose?: string; coaching_type?: string; count: number | string }) => ({
      name:  typeLabel(r.coaching_purpose ?? r.coaching_type ?? ''),
      type:  r.coaching_purpose ?? r.coaching_type ?? '',
      count: Number(r.count),
    })
  )

  // Tremor DonutChart data: status distribution
  const statusData = (s.sessions_by_status ?? []).map(
    (r: { status: string; count: number | string }) => ({ name: r.status, Sessions: Number(r.count) })
  )

  // Tremor DonutChart needs colors as Tremor color names; map status to closest Tremor color
  const donutColors: string[] = statusData.map((d: { name: string }) =>
    ({ DRAFT: 'slate', SCHEDULED: 'indigo', AWAITING_CSR_ACTION: 'amber',
       COMPLETED: 'emerald', FOLLOW_UP_REQUIRED: 'orange', CLOSED: 'gray' } as Record<string, string>
    )[d.name] ?? 'slate'
  )


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
          <span className="font-medium text-slate-700">{s.total_sessions ?? '—'}</span> sessions in range
        </div>
      </QualityFilterBar>

      {summaryError && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <TableErrorState message="Failed to load summary metrics." onRetry={summaryRefetch} />
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Total Sessions"      value={summaryLoading ? '—' : (s.total_sessions ?? 0)} icon={MessageSquare} />
        <StatCard label="Completion Rate"     value={summaryLoading ? '—' : `${compRate}%`} icon={TrendingUp}
          valueClass={compRate >= 70 ? 'text-emerald-600' : compRate >= 40 ? 'text-amber-600' : 'text-red-600'} />
        <StatCard label="Avg Days to Complete"
          value={summaryLoading ? '—' : s.avg_days_to_completion != null ? `${s.avg_days_to_completion}d` : '—'}
          icon={Clock} />
        <StatCard label="Quiz Pass Rate"      value={summaryLoading ? '—' : `${quizRate}%`} icon={CheckCircle} />
        <StatCard label="Repeat Coaching"     value={summaryLoading ? '—' : `${s.repeat_coaching_rate ?? 0}%`}
          icon={RefreshCw}
          valueClass={(s.repeat_coaching_rate ?? 0) > 20 ? 'text-amber-600' : undefined} />
      </div>

      {/* ── Charts 2x2 grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* Sessions by Week — Tremor BarChart */}
        <ChartCard title="Sessions by Week">
          {weekData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <BarChart
                data={weekData} index="Week" categories={['Sessions']}
                colors={['blue']} showLegend={false} yAxisWidth={32}
                className="h-[220px]"
              />
          }
        </ChartCard>

        {/* Top Topics — Tremor BarChart (layout vertical) */}
        <ChartCard title="Top Topics">
          {topicData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <BarChart
                data={topicData} index="Topic" categories={['Sessions']}
                colors={['blue']} layout="vertical" showLegend={false}
                yAxisWidth={120} className="h-[220px]"
              />
          }
        </ChartCard>

        {/* Sessions by Type — Recharts (per-bar custom colors, not supported in Tremor) */}
        <ChartCard title="Sessions by Type">
          {typeData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <ResponsiveContainer width="100%" height={220}>
                <RechartsBarChart data={typeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Sessions">
                    {typeData.map((entry, idx) => (
                      <Cell key={idx} fill={TYPE_COLORS[entry.type] ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </RechartsBarChart>
              </ResponsiveContainer>
          }
        </ChartCard>

        {/* Status Distribution — Tremor DonutChart */}
        <ChartCard title="Status Distribution">
          {statusData.length === 0
            ? <p className="text-center text-slate-400 text-[13px] py-10">No data in range</p>
            : <DonutChart
                data={statusData} index="name" category="Sessions"
                colors={donutColors} className="h-[220px]"
                valueFormatter={v => `${v} sessions`}
              />
          }
        </ChartCard>

      </div>

      {/* ── CSR Drill-Down Table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-slate-800">CSR Breakdown</p>
          {csrOptions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {csrOptions.slice(0, 6).map(name => (
                <Button key={name} variant="ghost" size="sm"
                  onClick={() => setMany({ csrs: selectedCsrs.includes(name) ? selectedCsrs.filter(c => c !== name).join(',') : [...selectedCsrs, name].join(','), page: '1' })}
                  className={cn('px-2.5 py-0.5 h-auto rounded-full text-[11px] font-medium',
                    selectedCsrs.includes(name) ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                  {name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {csrLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : csrError ? (
          <TableErrorState message="Failed to load coaching data." onRetry={csrRefetch} />
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
              ) : csrRows.map(csr => (
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
                    {csr.avg_days_to_completion != null ? `${csr.avg_days_to_completion}d` : '—'}
                  </TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{csr.quizzes_passed ?? 0}</TableCell>
                  <TableCell className="text-[13px] text-slate-500 max-w-[120px] truncate">{csr.most_common_topic ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">
                    {csr.last_session_date ? formatQualityDate(csr.last_session_date) : '—'}
                  </TableCell>
                  <TableCell className="text-slate-400 text-[13px]">→</TableCell>
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
