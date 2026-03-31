import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, Calendar, Clock, AlertTriangle,
  CheckCircle, TrendingUp,
} from 'lucide-react'
import trainingService, { type CoachingSession } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useQualityRole } from '@/hooks/useQualityRole'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function coachingLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function TopicChips({ topics, max = 2 }: { topics: string[]; max?: number }) {
  const shown = topics.slice(0, max)
  const extra = topics.length - max
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(t => (
        <span key={t} className="inline-block bg-slate-100 text-slate-600 text-[11px] px-2 py-0.5 rounded-full">
          {t}
        </span>
      ))}
      {extra > 0 && (
        <span className="inline-block bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5 rounded-full">
          +{extra}
        </span>
      )}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  valueClass?: string
  onClick?: () => void
}

function StatCard({ label, value, icon: Icon, valueClass, onClick }: StatCardProps) {
  return (
    <div
      className={cn(
        'relative bg-white rounded-xl border border-slate-200 p-5 overflow-hidden',
        onClick && 'cursor-pointer hover:border-primary/40 transition-colors',
      )}
      onClick={onClick}
    >
      <Icon className="h-8 w-8 absolute top-4 right-4 text-slate-900 opacity-10" />
      <p className={cn('text-3xl font-bold text-slate-900', valueClass)}>{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  )
}

// ── CSR View ──────────────────────────────────────────────────────────────────

function CSRView() {
  const navigate = useNavigate()

  // CSRs cannot call trainer-only stats endpoint — derive counts from sessions list
  const { data: sessionsPage, isLoading: sessionsLoading, isError: sessionsError, refetch: sessionsRefetch } = useQuery({
    queryKey: ['my-coaching-overview'],
    queryFn: () => trainingService.getMyCoachingSessions({ limit: 20 }),
  })

  const sessions = sessionsPage?.items ?? []
  const awaitingCount = useMemo(
    () => sessions.filter(s => ['IN_PROCESS', 'AWAITING_CSR_ACTION'].includes(s.status)).length,
    [sessions],
  )
  const completedCount = useMemo(
    () => sessions.filter(s => ['COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED'].includes(s.status)).length,
    [sessions],
  )
  const statsLoading = sessionsLoading

  return (
    <QualityListPage>
      <QualityPageHeader title="Training Overview" />

      {/* Attention banner */}
      {!statsLoading && awaitingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800">
              You have {awaitingCount} session{awaitingCount > 1 ? 's' : ''} awaiting your response
            </span>
          </div>
          <Button size="sm" onClick={() => navigate('/app/training/my-coaching')}>
            View My Coaching
          </Button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Needs Your Response"
          value={statsLoading ? '—' : awaitingCount}
          icon={Clock}
          valueClass={awaitingCount > 0 ? 'text-amber-600' : undefined}
        />
        <StatCard
          label="Completed This Month"
          value={statsLoading ? '—' : completedCount}
          icon={CheckCircle}
          valueClass="text-emerald-600"
        />
      </div>

      {/* Recent sessions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <p className="text-base font-semibold text-slate-900">Recent Coaching</p>
        </div>
        {sessionsLoading ? (
          <TableLoadingSkeleton rows={5} />
        ) : sessionsError ? (
          <TableErrorState message="Failed to load coaching sessions." onRetry={sessionsRefetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Topics</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableEmptyState colSpan={5} title="No coaching sessions yet" />
              ) : (
                sessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        {coachingLabel(s.coaching_purpose)}
                      </span>
                    </TableCell>
                    <TableCell><TopicChips topics={s.topics} /></TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary"
                        onClick={() => navigate(`/app/training/my-coaching/${s.id}`)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </QualityListPage>
  )
}

// ── Trainer / Manager / Admin View ────────────────────────────────────────────

function TrainerView() {
  const navigate = useNavigate()

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: statsRefetch } = useQuery({
    queryKey: ['training-stats-trainer'],
    queryFn: () => trainingService.getCoachingStats(),
  })

  const { data: recentPage, isLoading: recentLoading, isError: recentError, refetch: recentRefetch } = useQuery({
    queryKey: ['training-recent'],
    queryFn: () => trainingService.getCoachingSessions({ limit: 10, sort: 'session_date', dir: 'desc' }),
  })

  const { data: overduePage, isLoading: overdueLoading, isError: overdueError, refetch: overdueRefetch } = useQuery({
    queryKey: ['training-overdue'],
    queryFn: () => trainingService.getCoachingSessions({ overdue_only: true, limit: 10 }),
  })

  const recentSessions = recentPage?.items ?? []
  const overdueSessions = overduePage?.items ?? []

  // Group overdue/awaiting sessions by CSR for the Needs Attention panel
  const attentionGroups = useMemo(() => {
    const needs = [
      ...overdueSessions,
      ...recentSessions.filter(s =>
        ['IN_PROCESS', 'AWAITING_CSR_ACTION'].includes(s.status) &&
        !overdueSessions.find(o => o.id === s.id),
      ),
    ]
    const map = new Map<number, { csr_id: number; csr_name: string; sessions: CoachingSession[] }>()
    for (const s of needs) {
      const existing = map.get(s.csr_id)
      if (existing) {
        existing.sessions.push(s)
      } else {
        map.set(s.csr_id, { csr_id: s.csr_id, csr_name: s.csr_name, sessions: [s] })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.sessions.length - a.sessions.length)
  }, [overdueSessions, recentSessions])

  const s = stats ?? { sessionsThisMonth: 0, awaitingCsrAction: 0, overdueSessions: 0, quizPassRate: 0, completionRate: 0 }

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Training Overview"
        actions={
          <Button onClick={() => navigate('/app/training/coaching/new')}>
            New Session
          </Button>
        }
      />

      {/* Five stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard
          label="Sessions This Month"
          value={statsLoading ? '—' : s.sessionsThisMonth}
          icon={Calendar}
        />
        <StatCard
          label="Awaiting CSR"
          value={statsLoading ? '—' : s.awaitingCsrAction}
          icon={Clock}
          valueClass={s.awaitingCsrAction > 0 ? 'text-amber-600' : undefined}
          onClick={() => navigate('/app/training/coaching?statuses=AWAITING_CSR_ACTION,IN_PROCESS')}
        />
        <StatCard
          label="Overdue"
          value={statsLoading ? '—' : s.overdueSessions}
          icon={AlertTriangle}
          valueClass={s.overdueSessions > 0 ? 'text-red-600' : undefined}
          onClick={() => navigate('/app/training/coaching?overdue=true')}
        />
        <StatCard
          label="Quiz Pass Rate"
          value={statsLoading ? '—' : `${s.quizPassRate}%`}
          icon={CheckCircle}
        />
        <StatCard
          label="Completion Rate"
          value={statsLoading ? '—' : `${s.completionRate}%`}
          icon={TrendingUp}
        />
      </div>

      {/* Two-panel grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* Left: Recent Sessions */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <p className="text-base font-semibold text-slate-900">Recent Sessions</p>
          </div>
          {recentLoading ? (
            <TableLoadingSkeleton rows={5} />
          ) : recentError ? (
            <TableErrorState message="Failed to load recent sessions." onRetry={recentRefetch} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>CSR</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Topics</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSessions.length === 0 ? (
                  <TableEmptyState colSpan={5} title="No sessions yet" />
                ) : (
                  recentSessions.map(s => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate(`/app/training/coaching/${s.id}`)}
                    >
                      <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                        {formatQualityDate(s.session_date)}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{s.csr_name}</TableCell>
                      <TableCell>
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          {coachingLabel(s.coaching_purpose)}
                        </span>
                      </TableCell>
                      <TableCell><TopicChips topics={s.topics} /></TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Right: Needs Attention */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <p className="text-base font-semibold text-slate-900">Needs Attention</p>
          </div>
          {overdueLoading ? (
            <TableLoadingSkeleton rows={5} />
          ) : overdueError ? (
            <TableErrorState message="Failed to load overdue sessions." onRetry={overdueRefetch} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CSR</TableHead>
                  <TableHead className="text-center">Open</TableHead>
                  <TableHead>Oldest Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attentionGroups.length === 0 ? (
                  <TableEmptyState
                    colSpan={3}
                    icon={CheckCircle}
                    title="All caught up"
                    description="No overdue or pending sessions"
                  />
                ) : (
                  attentionGroups.map(g => {
                    const dueDates = g.sessions
                      .filter(s => s.follow_up_date)
                      .map(s => new Date(s.follow_up_date!).getTime())
                    const oldest = dueDates.length ? new Date(Math.min(...dueDates)) : null
                    const isPast = oldest ? oldest < new Date() : false
                    return (
                      <TableRow
                        key={g.csr_id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => navigate(`/app/training/coaching?csrs=${g.csr_id}`)}
                      >
                        <TableCell className="font-medium text-sm">{g.csr_name}</TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-1.5">
                            {g.sessions.length}
                          </span>
                        </TableCell>
                        <TableCell className={cn('text-sm whitespace-nowrap', isPast && 'text-red-600 font-medium')}>
                          {oldest ? formatQualityDate(oldest.toISOString()) : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>

      </div>
    </QualityListPage>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrainingOverviewPage() {
  const { isCSR } = useQualityRole()
  return isCSR ? <CSRView /> : <TrainerView />
}
