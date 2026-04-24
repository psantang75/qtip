import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, MessageSquare, Eye, ChevronDown, ChevronUp, Users, Flame } from 'lucide-react'
import trainingService, { type CoachingSession } from '@/services/trainingService'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { ListPagination } from '@/components/common/ListPagination'
import { CoachingFilterBar, ALL_STATUSES } from '@/components/training/CoachingFilterBar'
import { TopicListTooltip } from '@/components/training/TopicListTooltip'
import { RowActionButton } from '@/components/common/RowActionButton'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'

import {
  COACHING_PURPOSE_LABELS,
  COACHING_FORMAT_LABELS,
  STATUS_LABELS,
} from '@/constants/labels'

const PURPOSE_MAP = COACHING_PURPOSE_LABELS
const FORMAT_MAP  = COACHING_FORMAT_LABELS


export { TopicChips } from '@/components/training/TopicChips'

export function QuizStatusBadge({ session }: { session: CoachingSession }) {
  const quizCount   = Number(session.quiz_count   ?? session.quizzes?.length ?? 0)
  const passedCount = Number(session.quiz_passed_count ?? 0)
  const attempts    = session.quiz_attempts ?? []

  if (quizCount === 0 && !session.quizzes?.length)
    return <span className="text-[13px] text-slate-300">&mdash;</span>

  const allPassed = quizCount > 0
    ? passedCount >= quizCount
    : attempts.some(a => a.passed)

  if (allPassed || ['COMPLETED', 'CLOSED', 'CANCELED'].includes(session.status))
    return <StatusBadge status="QUIZ_PASSED" />

  return <StatusBadge status="QUIZ_ASSIGNED" />
}

// ── Page ──────────────────────────────────────────────────────────────────────

// ── Date urgency helper ───────────────────────────────────────────────────────

export function dateUrgency(dateStr?: string | null): { label: string; cls: string; overdue?: boolean } | null {
  if (!dateStr) return null
  const today = new Date().toISOString().slice(0, 10)
  const d     = dateStr.slice(0, 10)
  if (d === today) return { label: 'Today',                      cls: 'text-amber-600 font-semibold' }
  if (d  < today)  return { label: formatQualityDate(dateStr), cls: 'text-red-600 font-semibold', overdue: true }
  return               { label: formatQualityDate(dateStr),       cls: 'text-slate-600' }
}

/** Returns the most actionable upcoming date for a session, with a type label. */
function nextDue(s: CoachingSession): { date: string | null; type: 'D' | 'F' | null } {
  const due = s.due_date ?? null
  const fu  = s.follow_up_date ?? null
  if (s.status === 'FOLLOW_UP_REQUIRED' && fu) return { date: fu, type: 'F' }
  if (due && fu) return due <= fu ? { date: due, type: 'D' } : { date: fu, type: 'F' }
  if (due) return { date: due, type: 'D' }
  if (fu)  return { date: fu,  type: 'F' }
  return { date: null, type: null }
}

export default function CoachingSessionsPage() {
  const navigate = useNavigate()
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    agents: '', statuses: '', formats: '', topics: '',
    from: defaultFrom, to: defaultTo, overdue: '', dueToday: '', sessionId: '',
    page: '1', size: '20', expanded: '',
  })

  const expandedParam    = get('expanded')
  const expandedBatches  = useMemo(() => new Set(expandedParam ? expandedParam.split(',').filter(Boolean) : []), [expandedParam])
  const toggleBatch = (batchId: string) => {
    const next = new Set(expandedBatches)
    next.has(batchId) ? next.delete(batchId) : next.add(batchId)
    set('expanded', [...next].join(','))
  }

  const agentsParam   = get('agents')
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

  const selectedAgents   = useMemo(() => agentsParam   ? agentsParam.split(',').filter(Boolean)   : [], [agentsParam])
  const selectedStatuses = useMemo(() => statusesParam ? statusesParam.split(',').filter(Boolean)  : [], [statusesParam])
  const selectedFormats  = useMemo(() => formatsParam  ? formatsParam.split(',').filter(Boolean)   : [], [formatsParam])
  const selectedTopics   = useMemo(() => topicsParam   ? topicsParam.split(',').filter(Boolean)    : [], [topicsParam])

  // Fetch ALL sessions for the date range in one call
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['coaching-sessions', dateFrom, dateTo, overdue, dueToday],
    queryFn: () => trainingService.getCoachingSessions({
      page: 1,
      limit: 1000,
      date_from:    dateFrom || undefined,
      date_to:      dateTo   || undefined,
      overdue_only: overdue   === 'true' ? true : undefined,
      due_today:    dueToday  === 'true' ? true : undefined,
    }),
    placeholderData: (prev) => prev,
  })

  const allItems = data?.items ?? []

  // Dropdown options from the FULL result set
  const agentOptions = useMemo(() => {
    return Array.from(new Set(allItems.map(s => s.csr_name).filter(Boolean))).sort()
  }, [allItems])

  const topicOptions = useMemo(() => {
    return Array.from(new Set(allItems.flatMap(s => s.topics))).sort()
  }, [allItems])

  const allExceptClosed = useMemo(
    () => ALL_STATUSES.map(s => STATUS_LABELS[s]).filter(s => s !== 'Closed' && s !== 'Canceled'), [],
  )
  const effectiveSelectedStatuses = useMemo(
    () => selectedStatuses.length === 0 ? allExceptClosed : selectedStatuses,
    [selectedStatuses, allExceptClosed],
  )

  const filtered = useMemo(() => {
    let items = allItems
    if (sessionId)                        items = items.filter(s => String(s.id).includes(sessionId))
    if (selectedAgents.length)            items = items.filter(s => selectedAgents.includes(s.csr_name))
    if (effectiveSelectedStatuses.length) items = items.filter(s => effectiveSelectedStatuses.includes(STATUS_LABELS[s.status] ?? s.status))
    if (selectedFormats.length)           items = items.filter(s => selectedFormats.includes(FORMAT_MAP[s.coaching_format] ?? s.coaching_format))
    if (selectedTopics.length)            items = items.filter(s => s.topics.some(t => selectedTopics.includes(t)))
    return items
  }, [allItems, sessionId, selectedAgents, effectiveSelectedStatuses, selectedFormats, selectedTopics])

  const { sort, dir, toggle, sorted: sortedItems } = useListSort(filtered)

  // Group sessions by batch_id — batched sessions collapse into one summary row
  const { rows: listRows, batchMap } = useMemo(() => {
    const batchMap = new Map<string, typeof sortedItems>()
    const standalone: typeof sortedItems = []
    for (const s of sortedItems) {
      if (s.batch_id) {
        const group = batchMap.get(s.batch_id) ?? []
        group.push(s)
        batchMap.set(s.batch_id, group)
      } else {
        standalone.push(s)
      }
    }
    // Rows: one entry per standalone session OR one entry per batch (representative = first session)
    const rows = sortedItems.reduce<{ key: string; batchId?: string; session: typeof sortedItems[0] }[]>((acc, s) => {
      if (!s.batch_id) { acc.push({ key: String(s.id), session: s }); return acc }
      if (!acc.some(r => r.batchId === s.batch_id)) acc.push({ key: s.batch_id, batchId: s.batch_id, session: s })
      return acc
    }, [])
    return { rows, batchMap }
  }, [sortedItems])

  // Client-side pagination on grouped rows
  const paginatedRows = listRows.slice((page - 1) * pageSize, page * pageSize)
  const displayTotal = filtered.length

  return (
    <ListPageShell>
      <ListPageHeader
        title="Training Sessions"
        actions={
          <Button
            variant="primary"
            onClick={() => navigate('/app/training/coaching/new')}
          >
            <Plus className="h-4 w-4 mr-1" /> New Session
          </Button>
        }
      />

      <CoachingFilterBar
        values={{ statuses: selectedStatuses, formats: selectedFormats, topics: selectedTopics, sessionId, dateFrom, dateTo, dueToday, overdue }}
        setMany={setMany}
        hasAnyFilter={hasAnyFilter}
        onReset={reset}
        resultTotal={displayTotal}
        itemCount={allItems.length}
        agentOptions={agentOptions}
        selectedAgents={selectedAgents}
        topicOptions={topicOptions}
      />

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load training sessions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="id" sort={sort} dir={dir} onSort={toggle} className="w-[100px]">Session #</SortableTableHead>
                <SortableTableHead field="session_date"  sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Date</SortableTableHead>
                <SortableTableHead field="status"        sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Status</SortableTableHead>
                <SortableTableHead field="csr_name"      sort={sort} dir={dir} onSort={toggle} className="min-w-[200px]">Agent</SortableTableHead>
                <TableHead className="min-w-[120px]">Purpose</TableHead>
                <TableHead className="min-w-[120px]">Format</TableHead>
                <TableHead className="min-w-[160px]">Topics</TableHead>
                <TableHead className="min-w-[80px]">Quiz</TableHead>
                <SortableTableHead field="due_date" sort={sort} dir={dir} onSort={toggle} className="min-w-[130px]">Next Due</SortableTableHead>
                <TableHead className="w-24" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.length === 0 ? (
                <TableEmptyState
                  colSpan={10}
                  icon={MessageSquare}
                  title="No training sessions found"
                  description="Create a new session to get started"
                  action={{ label: 'New Session', onClick: () => navigate('/app/training/coaching/new') }}
                />
              ) : paginatedRows.map(({ key, batchId, session: s }) => {
                const batchSessions = batchId ? (batchMap.get(batchId) ?? [s]) : null
                const isExpanded = batchId ? expandedBatches.has(batchId) : false
                const isBatch = !!batchId && (batchSessions?.length ?? 0) > 1

                return (
                <React.Fragment key={key}>

                {/* ── Batch parent row ── */}
                {isBatch ? (
                  <TableRow className="bg-slate-50 border-l-4 border-l-primary hover:bg-slate-100/60">
                    <TableCell className="text-[13px] text-slate-300">&mdash;</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-[13px] text-slate-500">
                        <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{batchSessions!.length} Agents</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{PURPOSE_MAP[s.coaching_purpose] ?? s.coaching_purpose}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{FORMAT_MAP[s.coaching_format] ?? s.coaching_format}</TableCell>
                    <TableCell className="max-w-[180px]">
                      <TopicListTooltip topics={s.topics} />
                    </TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell>
                      <RowActionButton
                        icon={isExpanded ? ChevronUp : ChevronDown}
                        onClick={() => toggleBatch(batchId!)}
                      >
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </RowActionButton>
                    </TableCell>
                  </TableRow>
                ) : (
                  /* ── Individual session row ── */
                  <TableRow
                    className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/training/coaching/${s.id}`)}
                  >
                    <TableCell className="text-[13px] text-slate-500">{s.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-slate-600">{s.csr_name}</span>
                        {(s.repeat_topics?.length ?? 0) > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Flame className="h-3.5 w-3.5 text-orange-500 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                              <p className="text-[12px] font-semibold text-slate-700 mb-1">Repeat topics</p>
                              <ul className="space-y-1">
                                {s.repeat_topics!.map(t => (
                                  <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{PURPOSE_MAP[s.coaching_purpose] ?? s.coaching_purpose}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{FORMAT_MAP[s.coaching_format] ?? s.coaching_format}</TableCell>
                    <TableCell className="max-w-[180px]">
                      <TopicListTooltip topics={s.topics} />
                    </TableCell>
                    <TableCell><QuizStatusBadge session={s} /></TableCell>
                    <TableCell className="text-[13px] whitespace-nowrap">
                      {(() => {
                        const nd = nextDue(s)
                        if (!nd.date) return <span className="text-slate-300">&mdash;</span>
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default text-slate-600">
                                {formatQualityDate(nd.date)}
                                <span className="ml-1 text-[10px] text-slate-400 font-medium">{nd.type}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                              <div className="space-y-1 text-[12px]">
                                <div className="flex gap-3"><span className="text-slate-400 w-20">Due Date</span><span className="text-slate-700">{s.due_date ? formatQualityDate(s.due_date) : '—'}</span></div>
                                <div className="flex gap-3"><span className="text-slate-400 w-20">Follow-Up</span><span className="text-slate-700">{s.follow_up_date ? formatQualityDate(s.follow_up_date) : '—'}</span></div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )
                      })()}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <RowActionButton icon={Eye}
                        onClick={() => navigate(`/app/training/coaching/${s.id}`)}>
                        View
                      </RowActionButton>
                    </TableCell>
                  </TableRow>
                )}

                {/* ── Expanded batch sub-rows ── */}
                {isBatch && isExpanded && batchSessions!.map(bs => (
                  <TableRow key={bs.id} className="cursor-pointer hover:bg-primary/5 bg-blue-50/30 border-l-4 border-l-primary/30"
                    onClick={() => navigate(`/app/training/coaching/${bs.id}`)}>
                    <TableCell className="text-[13px] text-slate-500 pl-8">{bs.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">
                      {formatQualityDate(bs.session_date)}
                    </TableCell>
                    <TableCell><StatusBadge status={bs.status} /></TableCell>
                    <TableCell>
                      <span className="text-[13px] text-slate-600">{bs.csr_name}</span>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-500">{PURPOSE_MAP[bs.coaching_purpose] ?? bs.coaching_purpose}</TableCell>
                    <TableCell className="text-[13px] text-slate-500">{FORMAT_MAP[bs.coaching_format] ?? bs.coaching_format}</TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell><QuizStatusBadge session={bs} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">
                      {(() => {
                        const nd = nextDue(bs)
                        if (!nd.date) return <span className="text-slate-300">&mdash;</span>
                        return (
                          <span>
                            {formatQualityDate(nd.date)}
                            <span className="ml-1 text-[10px] text-slate-400 font-medium">{nd.type}</span>
                          </span>
                        )
                      })()}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <RowActionButton icon={Eye}
                        onClick={() => navigate(`/app/training/coaching/${bs.id}`)}>
                        View
                      </RowActionButton>
                    </TableCell>
                  </TableRow>
                ))}
                </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </ListCard>

      <ListPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(listRows.length / pageSize))}
        totalItems={listRows.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </ListPageShell>
  )
}


