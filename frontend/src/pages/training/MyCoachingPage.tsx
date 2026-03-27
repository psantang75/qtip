import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, BookOpen } from 'lucide-react'
import trainingService from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { CoachingTypeBadge, TopicChips } from './CoachingSessionsPage'

// ── CSR-friendly status labels ────────────────────────────────────────────────

const CSR_STATUS: Record<string, { label: string; classes: string }> = {
  SCHEDULED:           { label: 'Upcoming',            classes: 'bg-slate-100   text-slate-600'               },
  DELIVERED:           { label: 'Needs Your Response',  classes: 'bg-amber-100   text-amber-800 font-semibold'  },
  AWAITING_CSR_ACTION: { label: 'Needs Your Response',  classes: 'bg-amber-100   text-amber-800 font-semibold'  },
  QUIZ_PENDING:        { label: 'Quiz Required',         classes: 'bg-purple-100  text-purple-800'               },
  COMPLETED:           { label: 'Completed',             classes: 'bg-emerald-100 text-emerald-800'              },
  FOLLOW_UP_REQUIRED:  { label: 'Completed',             classes: 'bg-emerald-100 text-emerald-800'              },
  CLOSED:              { label: 'Closed',                classes: 'bg-slate-100   text-slate-500'               },
}

function CSRStatusBadge({ status }: { status: string }) {
  const c = CSR_STATUS[status] ?? { label: status, classes: 'bg-slate-100 text-slate-600' }
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px]', c.classes)}>
      {c.label}
    </span>
  )
}

// ── Sorting ───────────────────────────────────────────────────────────────────

const NEEDS_RESPONSE = new Set(['DELIVERED', 'AWAITING_CSR_ACTION', 'QUIZ_PENDING'])
const COMPLETED_SET  = new Set(['COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED'])
const SORT_PRIORITY: Record<string, number> = { DELIVERED: 0, AWAITING_CSR_ACTION: 0, QUIZ_PENDING: 1 }

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'needs_response' | 'completed'

export default function MyCoachingPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['my-coaching'],
    queryFn: () => trainingService.getMyCoachingSessions({ limit: 100 }),
  })

  const allSessions = data?.items ?? []
  const needsAction = allSessions.filter(s => NEEDS_RESPONSE.has(s.status)).length

  const filtered = useMemo(() => {
    let items = allSessions
    if (tab === 'needs_response') items = items.filter(s => NEEDS_RESPONSE.has(s.status))
    if (tab === 'completed')      items = items.filter(s => COMPLETED_SET.has(s.status))
    return [...items].sort((a, b) => {
      const diff = (SORT_PRIORITY[a.status] ?? 2) - (SORT_PRIORITY[b.status] ?? 2)
      if (diff !== 0) return diff
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity
      return ad - bd
    })
  }, [allSessions, tab])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'all',            label: 'All' },
    { id: 'needs_response', label: needsAction > 0 ? `Needs Response (${needsAction})` : 'Needs Response' },
    { id: 'completed',      label: 'Completed' },
  ]

  return (
    <QualityListPage>
      <QualityPageHeader title="My Coaching" />

      {needsAction > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
          <span className="text-sm font-medium text-amber-800">
            You have {needsAction} session{needsAction > 1 ? 's' : ''} awaiting your response.
          </span>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap',
              tab === t.id
                ? 'border-b-2 border-primary text-primary -mb-px'
                : 'text-slate-500 hover:text-slate-700',
            )}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={5} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Topics</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableEmptyState colSpan={6} icon={BookOpen}
                  title="No coaching sessions yet"
                  description="Your sessions will appear here" />
              ) : filtered.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/training/my-coaching/${s.id}`)}>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {formatQualityDate(s.session_date)}
                  </TableCell>
                  <TableCell><CoachingTypeBadge type={s.coaching_type} /></TableCell>
                  <TableCell><TopicChips topics={s.topics} max={2} /></TableCell>
                  <TableCell><CSRStatusBadge status={s.status} /></TableCell>
                  <TableCell className={cn('text-[13px] whitespace-nowrap', s.is_overdue ? 'text-red-600 font-medium' : 'text-slate-600')}>
                    {s.due_date ? formatQualityDate(s.due_date) : '—'}{s.is_overdue ? ' ⚠' : ''}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                      onClick={e => { e.stopPropagation(); navigate(`/app/training/my-coaching/${s.id}`) }}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </QualityListPage>
  )
}
