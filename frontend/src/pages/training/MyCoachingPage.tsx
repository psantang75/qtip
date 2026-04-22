import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Eye } from 'lucide-react'
import trainingService from '@/services/trainingService'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { StatusBadge } from '@/components/common/StatusBadge'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { CoachingFilterBar, ALL_STATUSES } from '@/components/training/CoachingFilterBar'
import { TopicListTooltip } from '@/components/training/TopicListTooltip'
import { RowActionButton } from '@/components/common/RowActionButton'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import {
  COACHING_PURPOSE_LABELS as PURPOSE_MAP,
  COACHING_FORMAT_LABELS as FORMAT_MAP,
  STATUS_LABELS,
} from '@/constants/labels'
import { QuizStatusBadge } from './CoachingSessionsPage'

const SORT_PRIORITY: Record<string, number> = { SCHEDULED: 0, AWAITING_CSR_ACTION: 0 }

export default function MyCoachingPage() {
  const navigate = useNavigate()
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    statuses: '', formats: '', topics: '',
    from: defaultFrom, to: defaultTo, overdue: '', dueToday: '', sessionId: '',
    page: '1', size: '20',
  })

  const statusesParam = get('statuses')
  const formatsParam  = get('formats')
  const topicsParam   = get('topics')
  const dateFrom      = get('from')
  const dateTo        = get('to')
  const overdue       = get('overdue')
  const dueToday      = get('dueToday')
  const sessionId     = get('sessionId')
  const page          = parseInt(get('page')) || 1
  const pageSize      = parseInt(get('size')) || 20

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  const selectedStatuses = useMemo(() => statusesParam ? statusesParam.split(',').filter(Boolean) : [], [statusesParam])
  const selectedFormats  = useMemo(() => formatsParam  ? formatsParam.split(',').filter(Boolean)  : [], [formatsParam])
  const selectedTopics   = useMemo(() => topicsParam   ? topicsParam.split(',').filter(Boolean)   : [], [topicsParam])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-coaching', dateFrom, dateTo, overdue, dueToday],
    queryFn:  () => trainingService.getMyCoachingSessions({ limit: 5000 }),
  })

  const allSessions = data?.items ?? []

  const topicOptions  = useMemo(() => [...new Set(allSessions.flatMap(s => s.topics))].sort(), [allSessions])

  const allExceptClosed = useMemo(
    () => ALL_STATUSES.map(s => STATUS_LABELS[s]).filter(s => s !== 'Closed' && s !== 'Canceled'), [],
  )
  const effectiveSelectedStatuses = useMemo(
    () => selectedStatuses.length === 0 ? allExceptClosed : selectedStatuses,
    [selectedStatuses, allExceptClosed],
  )

  const filtered = useMemo(() => {
    let items = allSessions
    if (sessionId)                        items = items.filter(s => String(s.id).includes(sessionId))
    if (effectiveSelectedStatuses.length) items = items.filter(s => effectiveSelectedStatuses.includes(STATUS_LABELS[s.status] ?? s.status))
    if (selectedFormats.length)           items = items.filter(s => selectedFormats.includes(FORMAT_MAP[s.coaching_format] ?? s.coaching_format))
    if (selectedTopics.length)            items = items.filter(s => s.topics.some(t => selectedTopics.includes(t)))
    if (dateFrom || dateTo) {
      items = items.filter(s => {
        const d = s.session_date?.slice(0, 10)
        if (!d) return false
        if (dateFrom && d < dateFrom) return false
        if (dateTo   && d > dateTo)   return false
        return true
      })
    }
    if (dueToday === 'true') {
      const today = new Date().toISOString().slice(0, 10)
      items = items.filter(s =>
        s.session_date?.slice(0, 10) === today ||
        s.due_date?.slice(0, 10)     === today ||
        s.follow_up_date?.slice(0, 10) === today
      )
    }
    if (overdue === 'true') {
      const today = new Date().toISOString().slice(0, 10)
      items = items.filter(s =>
        (s.due_date       && s.due_date.slice(0, 10)       < today && !['COMPLETED','CLOSED','CANCELED'].includes(s.status)) ||
        (s.follow_up_date && s.follow_up_date.slice(0, 10) < today && s.status === 'FOLLOW_UP_REQUIRED')
      )
    }
    return [...items].sort((a, b) => {
      const diff = (SORT_PRIORITY[a.status] ?? 2) - (SORT_PRIORITY[b.status] ?? 2)
      if (diff !== 0) return diff
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity
      return ad - bd
    })
  }, [allSessions, sessionId, effectiveSelectedStatuses, selectedFormats, selectedTopics, dateFrom, dateTo, dueToday, overdue])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const sessions   = sorted.slice((page - 1) * pageSize, page * pageSize)

  return (
    <ListPageShell>
      <ListPageHeader title="My Training" />


      <CoachingFilterBar
        values={{ statuses: selectedStatuses, formats: selectedFormats, topics: selectedTopics, sessionId, dateFrom, dateTo, dueToday, overdue }}
        setMany={setMany}
        hasAnyFilter={hasAnyFilter}
        onReset={reset}
        resultTotal={filtered.length}
        itemCount={allSessions.length}
        topicOptions={topicOptions}
      />

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={5} />
        ) : isError ? (
          <TableErrorState message="Failed to load training sessions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="session_date" sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Session Date</SortableTableHead>
                <SortableTableHead field="status"       sort={sort} dir={dir} onSort={toggle} className="min-w-[160px]">Status</SortableTableHead>
                <TableHead className="min-w-[120px]">Purpose</TableHead>
                <TableHead className="min-w-[120px]">Format</TableHead>
                <TableHead className="min-w-[160px]">Topics</TableHead>
                <TableHead className="min-w-[120px]">Quiz</TableHead>
                <SortableTableHead field="due_date"       sort={sort} dir={dir} onSort={toggle} className="min-w-[130px] pl-6">Due Date</SortableTableHead>
                <SortableTableHead field="follow_up_date" sort={sort} dir={dir} onSort={toggle} className="min-w-[140px] pl-6">Follow-Up Date</SortableTableHead>
                <TableHead className="w-24" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableEmptyState colSpan={9} icon={BookOpen}
                  title="No training sessions found"
                  description={hasAnyFilter ? 'Try adjusting your filters' : 'Your sessions will appear here'} />
              ) : sessions.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/training/my-coaching/${s.id}`)}>

                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {formatQualityDate(s.session_date)}
                  </TableCell>

                  <TableCell><StatusBadge status={s.status} /></TableCell>

                  <TableCell className="text-[13px] text-slate-600">
                    {PURPOSE_MAP[s.coaching_purpose] ?? s.coaching_purpose}
                  </TableCell>

                  <TableCell className="text-[13px] text-slate-600">
                    {FORMAT_MAP[s.coaching_format] ?? s.coaching_format}
                  </TableCell>

                  {/* Topics with tooltip */}
                  <TableCell className="max-w-[200px]">
                    <TopicListTooltip topics={s.topics} maxWidthClass="max-w-[200px]" />
                  </TableCell>

                  <TableCell><QuizStatusBadge session={s} /></TableCell>

                  <TableCell className="pl-6 text-[13px] whitespace-nowrap">
                    {s.due_date ? formatQualityDate(s.due_date) : <span className="text-slate-300">&mdash;</span>}
                  </TableCell>

                  <TableCell className="pl-6 text-[13px] text-slate-600 whitespace-nowrap">
                    {s.follow_up_date ? formatQualityDate(s.follow_up_date) : <span className="text-slate-300">&mdash;</span>}
                  </TableCell>

                  <TableCell onClick={e => e.stopPropagation()}>
                    <RowActionButton icon={Eye}
                      onClick={() => navigate(`/app/training/my-coaching/${s.id}`)}>
                      View
                    </RowActionButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </ListPageShell>
  )
}
