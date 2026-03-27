import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, MessageSquare } from 'lucide-react'
import trainingService, { type CoachingSession, type CoachingType } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { ListPagination } from '@/components/common/ListPagination'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const COACHING_TYPE_MAP: Record<CoachingType, string> = {
  WEEKLY_COACHING:      'Weekly',
  PERFORMANCE_COACHING: 'Performance',
  ESCALATION:           'Escalation',
  SIDE_BY_SIDE:         'Side-by-Side',
  TEAM_SESSION:         'Team',
}

const COACHING_TYPE_BY_LABEL = Object.fromEntries(
  (Object.entries(COACHING_TYPE_MAP) as [CoachingType, string][]).map(([k, v]) => [v, k]),
) as Record<string, CoachingType>

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled', DELIVERED: 'Delivered',
  AWAITING_CSR_ACTION: 'Awaiting CSR', QUIZ_PENDING: 'Quiz Pending',
  COMPLETED: 'Completed', FOLLOW_UP_REQUIRED: 'Follow-Up', CLOSED: 'Closed',
}
const ALL_STATUSES = Object.keys(STATUS_LABELS)
const STATUS_BY_LABEL = Object.fromEntries(Object.entries(STATUS_LABELS).map(([k, v]) => [v, k]))

// ── Exported helper components ────────────────────────────────────────────────

const TYPE_STYLES: Record<CoachingType, string> = {
  WEEKLY_COACHING:      'bg-blue-50   text-blue-700',
  PERFORMANCE_COACHING: 'bg-amber-50  text-amber-700',
  ESCALATION:           'bg-red-50    text-red-700',
  SIDE_BY_SIDE:         'bg-teal-50   text-teal-700',
  TEAM_SESSION:         'bg-indigo-50 text-indigo-700',
}

export function CoachingTypeBadge({ type }: { type: CoachingType }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      TYPE_STYLES[type] ?? 'bg-slate-100 text-slate-600',
    )}>
      {COACHING_TYPE_MAP[type] ?? type}
    </span>
  )
}

export function TopicChips({ topics, max = 2 }: { topics: string[]; max?: number }) {
  const shown = topics.slice(0, max)
  const extra = topics.length - max
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(t => (
        <span key={t} className="bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 rounded-full">{t}</span>
      ))}
      {extra > 0 && (
        <span className="bg-slate-100 text-slate-500 text-[11px] px-2 py-0.5 rounded-full">+{extra}</span>
      )}
    </div>
  )
}

export function QuizStatusBadge({ session }: { session: CoachingSession }) {
  if (!session.quiz_required) {
    return <span className="text-[11px] text-slate-400">Not required</span>
  }
  if (session.status === 'QUIZ_PENDING') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">Pending</span>
  }
  if (session.quiz_attempts?.some(a => a.passed)) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">Passed ✓</span>
  }
  if (session.quiz_attempts?.length) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800">Failed ✗</span>
  }
  if (['COMPLETED', 'CLOSED'].includes(session.status) && session.quiz_required) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">Passed ✓</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">Not started</span>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CoachingSessionsPage() {
  const navigate = useNavigate()
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    csrs: '', statuses: '', types: '', topics: '', from: defaultFrom, to: defaultTo,
    overdue: '', page: '1', size: '20',
  })

  const csrsParam    = get('csrs')
  const statusesParam = get('statuses')
  const typesParam   = get('types')
  const topicsParam  = get('topics')
  const dateFrom     = get('from')
  const dateTo       = get('to')
  const overdue      = get('overdue')
  const page         = parseInt(get('page')) || 1
  const pageSize     = parseInt(get('size')) || 20

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  // Parsed multi-select values (stored as display labels in URL)
  const selectedCsrs     = useMemo(() => csrsParam    ? csrsParam.split(',').filter(Boolean)    : [], [csrsParam])
  const selectedStatuses = useMemo(() => statusesParam ? statusesParam.split(',').filter(Boolean) : [], [statusesParam])
  const selectedTypes    = useMemo(() => typesParam   ? typesParam.split(',').filter(Boolean)   : [], [typesParam])
  const selectedTopics   = useMemo(() => topicsParam  ? topicsParam.split(',').filter(Boolean)  : [], [topicsParam])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['coaching-sessions', page, pageSize, dateFrom, dateTo, overdue],
    queryFn: () => trainingService.getCoachingSessions({
      page,
      limit: pageSize,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
      overdue_only: overdue === 'true' ? true : undefined,
    }),
    placeholderData: (prev: any) => prev,
  })

  // Derive filter options from current result set
  const csrOptions = useMemo(() => {
    const names = new Set((data?.items ?? []).map(s => s.csr_name).filter(Boolean))
    return Array.from(names).sort()
  }, [data?.items])

  const topicOptions = useMemo(() => {
    const all = (data?.items ?? []).flatMap(s => s.topics)
    return Array.from(new Set(all)).sort()
  }, [data?.items])

  const statusOptions = useMemo(() => {
    const present = new Set<string>((data?.items ?? []).map(s => s.status as string).filter(Boolean))
    return ALL_STATUSES.filter(s => present.has(s)).map(s => STATUS_LABELS[s])
  }, [data?.items])

  const typeOptions = Object.values(COACHING_TYPE_MAP)

  // Client-side filtering for multi-select
  const clientFiltered = useMemo(() => {
    let items = data?.items ?? []
    if (selectedCsrs.length)     items = items.filter(s => selectedCsrs.includes(s.csr_name))
    if (selectedStatuses.length) items = items.filter(s => selectedStatuses.includes(STATUS_LABELS[s.status] ?? s.status))
    if (selectedTypes.length)    items = items.filter(s => selectedTypes.includes(COACHING_TYPE_MAP[s.coaching_type] ?? s.coaching_type))
    if (selectedTopics.length)   items = items.filter(s => s.topics.some(t => selectedTopics.includes(t)))
    return items
  }, [data?.items, selectedCsrs, selectedStatuses, selectedTypes, selectedTopics])

  const { sort, dir, toggle, sorted: sortedItems } = useListSort(clientFiltered)

  const hasClientFilter = selectedCsrs.length > 0 || selectedStatuses.length > 0 || selectedTypes.length > 0 || selectedTopics.length > 0
  const displayTotal = hasClientFilter ? clientFiltered.length : (data?.total ?? 0)

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Coaching Sessions"
        actions={
          <Button
            className="bg-primary hover:bg-primary/90 text-white"
            onClick={() => navigate('/app/training/coaching/new')}
          >
            <Plus className="h-4 w-4 mr-1" /> New Session
          </Button>
        }
      />

      <QualityFilterBar
        hasFilters={hasAnyFilter || hasClientFilter}
        onReset={reset}
        resultCount={{ total: displayTotal }}
      >
        <StagedMultiSelect
          options={csrOptions}
          selected={selectedCsrs}
          onApply={v => setMany({ csrs: v.join(','), page: '1' })}
          placeholder="All CSRs"
          width="w-[200px]"
        />
        <StagedMultiSelect
          options={statusOptions}
          selected={selectedStatuses}
          onApply={v => setMany({ statuses: v.join(','), page: '1' })}
          placeholder="All Statuses"
          width="w-[180px]"
        />
        <StagedMultiSelect
          options={typeOptions}
          selected={selectedTypes}
          onApply={v => setMany({ types: v.join(','), page: '1' })}
          placeholder="All Types"
          width="w-[200px]"
        />
        <StagedMultiSelect
          options={topicOptions}
          selected={selectedTopics}
          onApply={v => setMany({ topics: v.join(','), page: '1' })}
          placeholder="All Topics"
          width="w-[200px]"
        />
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={v => setMany({ from: v.start, to: v.end, page: '1' })}
        />
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={overdue === 'true'}
            onChange={e => set('overdue', e.target.checked ? 'true' : '')}
            className="rounded border-slate-300"
          />
          Overdue only
        </label>
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load coaching sessions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="session_date" sort={sort} dir={dir} onSort={toggle}>Date</SortableTableHead>
                <SortableTableHead field="csr_name"    sort={sort} dir={dir} onSort={toggle}>CSR</SortableTableHead>
                <TableHead>Type</TableHead>
                <TableHead>Topics</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Quiz</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.length === 0 ? (
                <TableEmptyState
                  colSpan={8}
                  icon={MessageSquare}
                  title="No coaching sessions found"
                  description="Create a new session to get started"
                  action={{ label: 'New Session', onClick: () => navigate('/app/training/coaching/new') }}
                />
              ) : sortedItems.map(s => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/training/coaching/${s.id}`)}
                >
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {formatQualityDate(s.session_date)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-slate-900">{s.csr_name}</span>
                      {(s.repeat_topics?.length ?? 0) > 0 && (
                        <span title={`Repeat topics: ${s.repeat_topics!.join(', ')}`} className="text-orange-500 text-xs cursor-help">
                          🔥
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><CoachingTypeBadge type={s.coaching_type} /></TableCell>
                  <TableCell><TopicChips topics={s.topics} max={2} /></TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell><QuizStatusBadge session={s} /></TableCell>
                  <TableCell className={cn('text-[13px] whitespace-nowrap', s.is_overdue ? 'text-red-600 font-medium' : 'text-slate-600')}>
                    {s.due_date ? formatQualityDate(s.due_date) : '—'}{s.is_overdue ? ' ⚠' : ''}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[12px]"
                      onClick={e => { e.stopPropagation(); navigate(`/app/training/coaching/${s.id}`) }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={data?.totalPages ?? 1}
        totalItems={data?.total ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </QualityListPage>
  )
}
