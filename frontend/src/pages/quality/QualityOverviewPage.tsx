import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarCheck, AlertTriangle, TrendingUp, BarChart3,
  Users, ClipboardList, RefreshCw,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { useListSort } from '@/hooks/useListSort'

function StatCard({
  icon: Icon, label, value, valueClass = '',
}: { icon: React.ElementType; label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="text-[13px] text-muted-foreground">{label}</span>
      </div>
      <div className={cn('text-3xl font-bold text-slate-900', valueClass)}>{value}</div>
    </div>
  )
}

export default function QualityOverviewPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<'week' | 'month'>('week')

  const isAdminOrQA = user?.role_id === 1 || user?.role_id === 2
  const isManager = user?.role_id === 5
  const isCSR = user?.role_id === 3

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch } = useQuery({
    queryKey: ['qa-overview-stats', user?.role_id],
    queryFn: () =>
      isAdminOrQA ? qaService.getQAStats()
      : isManager  ? qaService.getManagerStats()
      : qaService.getCSRStats(),
    enabled: !!user,
  })

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['qa-csr-activity', period, user?.role_id],
    queryFn: () =>
      isAdminOrQA ? qaService.getQACsrActivity(period)
      : qaService.getManagerCsrActivity(period),
    enabled: !!user && (isAdminOrQA || isManager),
  })

  const { data: recentAudits, isLoading: auditsLoading } = useQuery({
    queryKey: ['csr-recent-audits'],
    queryFn: () => qaService.getCSRAudits({ limit: 5 }),
    enabled: !!user && isCSR,
  })

  // All hooks must be called before any conditional returns
  const csrSort = useListSort(recentAudits?.items ?? [])
  const actSort = useListSort(activity ?? [])

  if (statsLoading) {
    return (
      <div className="p-6 space-y-5">
        <div className="h-8 w-48 bg-slate-100 animate-pulse rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    )
  }

  if (statsError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center justify-between">
          <p className="text-red-700 font-medium">Failed to load overview stats.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Retry
          </Button>
        </div>
      </div>
    )
  }

  // ── CSR view ──────────────────────────────────────────────────────────────
  if (isCSR) {
    return (
      <div className="p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your personal QA performance</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={BarChart3} label="My Avg Score"
            value={stats?.avgScore != null ? `${stats.avgScore.toFixed(1)}%` : '—'}
            valueClass={scoreColor(stats?.avgScore ?? 0)}
          />
          <StatCard icon={CalendarCheck} label="Total Audits" value={stats?.totalAudits ?? 0} />
          <StatCard
            icon={AlertTriangle} label="Open Disputes"
            value={stats?.openDisputes ?? 0}
            valueClass={stats?.openDisputes ? 'text-red-600' : ''}
          />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Recent Audits</h2>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
              onClick={() => navigate('/app/quality/submissions')}>
              View All
            </Button>
          </div>
          {auditsLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-slate-100 animate-pulse rounded" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b border-slate-200">
                  <SortableTableHead field="created_at" sort={csrSort.sort} dir={csrSort.dir} onSort={csrSort.toggle}>Date</SortableTableHead>
                  <SortableTableHead field="form_name"  sort={csrSort.sort} dir={csrSort.dir} onSort={csrSort.toggle}>Form</SortableTableHead>
                  <SortableTableHead field="score"      sort={csrSort.sort} dir={csrSort.dir} onSort={csrSort.toggle} right>Score</SortableTableHead>
                  <SortableTableHead field="status"     sort={csrSort.sort} dir={csrSort.dir} onSort={csrSort.toggle}>Status</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csrSort.sorted.length ? (
                  csrSort.sorted.map((row: any) => (
                    <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50/50"
                      onClick={() => navigate(`/app/quality/submissions/${row.id}`)}>
                      <TableCell className="text-[13px] text-slate-600">
                        {new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </TableCell>
                      <TableCell className="text-[13px] font-medium text-slate-900">{row.form_name}</TableCell>
                      <TableCell className="text-right text-[13px] font-medium">
                        <span className={scoreColor(row.score ?? 0)}>{(row.score ?? 0).toFixed(1)}%</span>
                      </TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableEmptyState colSpan={4} title="No recent audits found." />
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    )
  }

  // ── Admin / QA / Manager view ─────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdminOrQA ? 'Department-wide QA performance' : "Your team's QA performance"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={CalendarCheck} label="Total Audits" value={stats?.totalAudits ?? 0} />
        <StatCard
          icon={BarChart3} label="Avg Score"
          value={stats?.avgScore != null ? `${stats.avgScore.toFixed(1)}%` : '—'}
          valueClass={scoreColor(stats?.avgScore ?? 0)}
        />
        <StatCard
          icon={AlertTriangle} label="Open Disputes"
          value={stats?.openDisputes ?? 0}
          valueClass={stats?.openDisputes ? 'text-red-600' : ''}
        />
        <StatCard icon={TrendingUp} label="Audits This Week" value={stats?.auditsThisWeek ?? 0} />
      </div>

      {isAdminOrQA && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'View Submissions', icon: ClipboardList, path: '/app/quality/submissions' },
            { label: 'View Disputes',    icon: AlertTriangle, path: '/app/quality/disputes' },
            { label: 'Analytics',        icon: BarChart3,     path: '/app/analytics/quality' },
          ].map(({ label, icon: Icon, path }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 hover:border-primary hover:bg-primary/5 transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <span className="font-medium text-slate-800">{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">CSR Activity</h2>
          <div className="flex gap-1">
            {(['week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1 text-sm rounded-md transition-colors',
                  period === p ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {p === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        </div>

        {activityLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="csr_name"        sort={actSort.sort} dir={actSort.dir} onSort={actSort.toggle}>CSR Name</SortableTableHead>
                <SortableTableHead field="department_name" sort={actSort.sort} dir={actSort.dir} onSort={actSort.toggle}>Department</SortableTableHead>
                <SortableTableHead field="total_reviews"   sort={actSort.sort} dir={actSort.dir} onSort={actSort.toggle} right>Reviews</SortableTableHead>
                {isAdminOrQA && <SortableTableHead field="avg_score" sort={actSort.sort} dir={actSort.dir} onSort={actSort.toggle} right>Avg Score</SortableTableHead>}
                <SortableTableHead field="disputes"        sort={actSort.sort} dir={actSort.dir} onSort={actSort.toggle} right>Disputes</SortableTableHead>
                {isAdminOrQA && <SortableTableHead field="last_audit_date" sort={actSort.sort} dir={actSort.dir} onSort={actSort.toggle}>Last Audit</SortableTableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {actSort.sorted.length ? (
                actSort.sorted.map((row: any) => (
                  <TableRow key={row.csr_id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium text-[13px] text-slate-900">{row.csr_name}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{row.department_name || '—'}</TableCell>
                    <TableCell className="text-right text-[13px]">{row.total_reviews}</TableCell>
                    {isAdminOrQA && (
                      <TableCell className="text-right">
                        <span className={cn('font-semibold text-[13px]', scoreColor(row.avg_score ?? 0))}>
                          {(row.avg_score ?? 0).toFixed(1)}%
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="text-right text-[13px]">{row.disputes}</TableCell>
                    {isAdminOrQA && (
                      <TableCell className="text-[13px] text-slate-500">
                        {row.last_audit_date
                          ? new Date(row.last_audit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={isAdminOrQA ? 6 : 4}
                  icon={Users}
                  title="No activity data for this period."
                />
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
