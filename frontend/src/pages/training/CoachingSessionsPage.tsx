import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, MessageSquare, Eye, ChevronDown, ChevronUp, Users, Flame, AlertTriangle } from 'lucide-react'
import trainingService, { type CoachingSession, type CoachingPurpose, type CoachingFormat } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { ListPagination } from '@/components/common/ListPagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'

// ── Labels (from central file) ────────────────────────────────────────────────

import {
  COACHING_PURPOSE_LABELS,
  COACHING_PURPOSE_STYLES,
  COACHING_FORMAT_LABELS,
  COACHING_FORMAT_STYLES,
  COACHING_STATUS_LABELS,
} from '@/constants/labels'

export const PURPOSE_MAP = COACHING_PURPOSE_LABELS
export const FORMAT_MAP  = COACHING_FORMAT_LABELS
export const STATUS_LABELS = COACHING_STATUS_LABELS
const ALL_STATUSES = Object.keys(COACHING_STATUS_LABELS)

// ── Exported helper components ────────────────────────────────────────────────

export function CoachingPurposeBadge({ purpose }: { purpose: CoachingPurpose }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      COACHING_PURPOSE_STYLES[purpose] ?? 'bg-slate-100 text-slate-600')}>
      {COACHING_PURPOSE_LABELS[purpose] ?? purpose}
    </span>
  )
}

export function CoachingFormatBadge({ format }: { format: CoachingFormat }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      COACHING_FORMAT_STYLES[format] ?? 'bg-slate-100 text-slate-600')}>
      {COACHING_FORMAT_LABELS[format] ?? format}
    </span>
  )
}


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

  if (allPassed || ['COMPLETED', 'CLOSED'].includes(session.status))
    return <span className="text-[13px] text-slate-500">Passed</span>

  return <span className="text-[13px] text-slate-500">Assigned</span>
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
    csrs: '', statuses: '', formats: '', topics: '',
    from: defaultFrom, to: defaultTo, overdue: '', dueToday: '', page: '1', size: '20',
    expanded: '',
  })

  const expandedParam    = get('expanded')
  const expandedBatches  = useMemo(() => new Set(expandedParam ? expandedParam.split(',').filter(Boolean) : []), [expandedParam])
  const toggleBatch = (batchId: string) => {
    const next = new Set(expandedBatches)
    next.has(batchId) ? next.delete(batchId) : next.add(batchId)
    set('expanded', [...next].join(','))
  }

  const csrsParam     = get('csrs')
  const statusesParam = get('statuses')
  const formatsParam  = get('formats')
  const topicsParam   = get('topics')
  const dateFrom      = get('from')
  const dateTo        = get('to')
  const overdue       = get('overdue')
  const dueToday      = get('dueToday')
  const page          = parseInt(get('page')) || 1
  const pageSize      = parseInt(get('size')) || 20

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  const selectedCsrs     = useMemo(() => csrsParam     ? csrsParam.split(',').filter(Boolean)     : [], [csrsParam])
  const selectedStatuses = useMemo(() => statusesParam ? statusesParam.split(',').filter(Boolean)  : [], [statusesParam])
  const selectedFormats  = useMemo(() => formatsParam  ? formatsParam.split(',').filter(Boolean)   : [], [formatsParam])
  const selectedTopics   = useMemo(() => topicsParam   ? topicsParam.split(',').filter(Boolean)    : [], [topicsParam])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['coaching-sessions', page, pageSize, dateFrom, dateTo, overdue, dueToday],
    queryFn: () => trainingService.getCoachingSessions({
      page,
      limit: pageSize,
      date_from:    dateFrom || undefined,
      date_to:      dateTo   || undefined,
      overdue_only: overdue   === 'true' ? true : undefined,
      due_today:    dueToday  === 'true' ? true : undefined,
    }),
    placeholderData: (prev) => prev,
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

  const statusOptions = ALL_STATUSES.map(s => STATUS_LABELS[s])

  // Default: all visible statuses except Closed. When user explicitly selects, use that instead.
  const allExceptClosed = useMemo(() => statusOptions.filter(s => s !== 'Closed'), [statusOptions])
  const effectiveSelectedStatuses = useMemo(
    () => selectedStatuses.length === 0 ? allExceptClosed : selectedStatuses,
    [selectedStatuses, allExceptClosed],
  )

  const formatOptions = Object.values(FORMAT_MAP)

  const clientFiltered = useMemo(() => {
    let items = data?.items ?? []
    if (selectedCsrs.length)             items = items.filter(s => selectedCsrs.includes(s.csr_name))
    if (effectiveSelectedStatuses.length) items = items.filter(s => effectiveSelectedStatuses.includes(STATUS_LABELS[s.status] ?? s.status))
    if (selectedFormats.length)          items = items.filter(s => selectedFormats.includes(FORMAT_MAP[s.coaching_format] ?? s.coaching_format))
    if (selectedTopics.length)           items = items.filter(s => s.topics.some(t => selectedTopics.includes(t)))
    return items
  }, [data?.items, selectedCsrs, effectiveSelectedStatuses, selectedFormats, selectedTopics])

  const { sort, dir, toggle, sorted: sortedItems } = useListSort(clientFiltered)

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

  const hasClientFilter = selectedCsrs.length > 0 || selectedStatuses.length > 0 || selectedFormats.length > 0 || selectedTopics.length > 0
  const displayTotal = hasClientFilter ? clientFiltered.length : (data?.total ?? 0)

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Training Sessions"
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
        {/* ── Row 1: CSR · Topics · Format · Status ── */}
        <StagedMultiSelect
          options={csrOptions}
          selected={selectedCsrs}
          onApply={v => setMany({ csrs: v.join(','), page: '1' })}
          placeholder="All CSRs"
          width="w-[280px]"
        />
        <StagedMultiSelect
          options={topicOptions}
          selected={selectedTopics}
          onApply={v => setMany({ topics: v.join(','), page: '1' })}
          placeholder="All Topics"
          width="w-[280px]"
        />
        <StagedMultiSelect
          options={formatOptions}
          selected={selectedFormats}
          onApply={v => setMany({ formats: v.join(','), page: '1' })}
          placeholder="All Formats"
          width="w-[200px]"
        />
        <StagedMultiSelect
          options={statusOptions}
          selected={effectiveSelectedStatuses}
          onApply={v => {
            const isDefault = v.length === allExceptClosed.length && allExceptClosed.every(s => v.includes(s))
            setMany({ statuses: isDefault ? '' : v.join(','), page: '1' })
          }}
          placeholder="All Statuses"
          width="w-[180px]"
        />

        {/* ── Row break ── */}
        <div className="w-full" />

        {/* ── Row 2: Session Date Range · Due Today · Overdue ── */}
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-slate-500 shrink-0">Session</span>
          <Input type="date" value={dateFrom} max={dateTo || undefined}
            onChange={e => setMany({ from: e.target.value, page: '1' })}
            className="h-9 w-[140px]" />
          <span className="text-[12px] text-slate-400">–</span>
          <Input type="date" value={dateTo} min={dateFrom || undefined}
            onChange={e => setMany({ to: e.target.value, page: '1' })}
            className="h-9 w-[140px]" />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <Checkbox checked={dueToday === 'true'}
            onCheckedChange={v => setMany({ dueToday: v ? 'true' : '', overdue: '', page: '1' })} />
          Due Today
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <Checkbox checked={overdue === 'true'}
            onCheckedChange={v => setMany({ overdue: v ? 'true' : '', dueToday: '', page: '1' })} />
          Overdue
        </label>
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load training sessions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <TableHead className="w-[60px] text-slate-400">#</TableHead>
                <SortableTableHead field="session_date"  sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Date</SortableTableHead>
                <SortableTableHead field="status"        sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Status</SortableTableHead>
                <SortableTableHead field="csr_name"      sort={sort} dir={dir} onSort={toggle} className="min-w-[200px]">CSR</SortableTableHead>
                <TableHead className="min-w-[120px]">Purpose</TableHead>
                <TableHead className="min-w-[120px]">Format</TableHead>
                <TableHead className="min-w-[160px]">Topics</TableHead>
                <TableHead className="min-w-[130px]">Quiz</TableHead>
                <SortableTableHead field="due_date" sort={sort} dir={dir} onSort={toggle} className="min-w-[130px]">Next Due</SortableTableHead>
                <TableHead className="w-24" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {listRows.length === 0 ? (
                <TableEmptyState
                  colSpan={10}
                  icon={MessageSquare}
                  title="No training sessions found"
                  description="Create a new session to get started"
                  action={{ label: 'New Session', onClick: () => navigate('/app/training/coaching/new') }}
                />
              ) : listRows.map(({ key, batchId, session: s }) => {
                const batchSessions = batchId ? (batchMap.get(batchId) ?? [s]) : null
                const isExpanded = batchId ? expandedBatches.has(batchId) : false
                const isBatch = !!batchId && (batchSessions?.length ?? 0) > 1

                return (
                <React.Fragment key={key}>

                {/* ── Batch parent row ── */}
                {isBatch ? (
                  <TableRow className="bg-slate-50 border-l-4 border-l-primary hover:bg-slate-100/60">
                    <TableCell className="text-[11px] text-slate-300 font-mono">&mdash;</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap font-medium">
                      {formatQualityDate(s.session_date)}
                    </TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-[13px] text-slate-500">
                        <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{batchSessions!.length} CSRs</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{PURPOSE_MAP[s.coaching_purpose] ?? s.coaching_purpose}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{FORMAT_MAP[s.coaching_format] ?? s.coaching_format}</TableCell>
                    <TableCell className="max-w-[180px]">
                      {s.topics.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block max-w-[180px] cursor-default">
                              {[...s.topics].sort().join(', ')}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">
                              {[...s.topics].sort().map(t => (
                                <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[13px] text-slate-300">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell><span className="text-[13px] text-slate-300">&mdash;</span></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm"
                        className="h-7 px-2 text-[12px] text-primary gap-1 hover:text-primary hover:bg-primary/10"
                        onClick={() => toggleBatch(batchId!)}>
                        {isExpanded
                          ? <><ChevronUp className="h-3.5 w-3.5" /> Collapse</>
                          : <><ChevronDown className="h-3.5 w-3.5" /> Expand</>
                        }
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  /* ── Individual session row ── */
                  <TableRow
                    className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/training/coaching/${s.id}`)}
                  >
                    <TableCell className="text-[11px] text-slate-400 font-mono">#{s.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-slate-900">{s.csr_name}</span>
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
                      {s.topics.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block max-w-[180px] cursor-default">
                              {[...s.topics].sort().join(', ')}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">
                              {[...s.topics].sort().map(t => (
                                <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[13px] text-slate-300">&mdash;</span>
                      )}
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
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                        onClick={() => navigate(`/app/training/coaching/${s.id}`)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                )}

                {/* ── Expanded batch sub-rows ── */}
                {isBatch && isExpanded && batchSessions!.map(bs => (
                  <TableRow key={bs.id} className="cursor-pointer hover:bg-primary/5 bg-blue-50/30 border-l-4 border-l-primary/30"
                    onClick={() => navigate(`/app/training/coaching/${bs.id}`)}>
                    <TableCell className="text-[11px] text-slate-400 font-mono pl-8">#{bs.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">
                      {formatQualityDate(bs.session_date)}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{STATUS_LABELS[bs.status] ?? bs.status}</TableCell>
                    <TableCell>
                      <span className="text-[13px] font-medium text-slate-800">{bs.csr_name}</span>
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
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                        onClick={() => navigate(`/app/training/coaching/${bs.id}`)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={hasClientFilter ? Math.max(1, Math.ceil(clientFiltered.length / pageSize)) : (data?.totalPages ?? 1)}
        totalItems={hasClientFilter ? clientFiltered.length : (data?.total ?? 0)}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </QualityListPage>
  )
}


