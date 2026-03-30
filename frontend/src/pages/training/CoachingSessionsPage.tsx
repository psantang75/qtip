import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, MessageSquare, Eye } from 'lucide-react'
import trainingService, { type CoachingSession, type CoachingPurpose, type CoachingFormat } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { DateFieldRangeFilter, type DateField } from '@/components/common/DateFieldRangeFilter'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { ListPagination } from '@/components/common/ListPagination'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const PURPOSE_MAP: Record<CoachingPurpose, string> = {
  WEEKLY:      'Weekly',
  PERFORMANCE: 'Performance',
  ONBOARDING:  'Onboarding',
}
const PURPOSE_STYLES: Record<CoachingPurpose, string> = {
  WEEKLY:      'bg-blue-50  text-blue-700',
  PERFORMANCE: 'bg-amber-50 text-amber-700',
  ONBOARDING:  'bg-teal-50  text-teal-700',
}

export const FORMAT_MAP: Record<CoachingFormat, string> = {
  ONE_ON_ONE:   '1-on-1',
  SIDE_BY_SIDE: 'Side-by-Side',
  TEAM_SESSION: 'Team',
}
const FORMAT_STYLES: Record<CoachingFormat, string> = {
  ONE_ON_ONE:   'bg-slate-100 text-slate-700',
  SIDE_BY_SIDE: 'bg-indigo-50 text-indigo-700',
  TEAM_SESSION: 'bg-purple-50 text-purple-700',
}

export const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Draft', IN_PROCESS: 'In Process',
  AWAITING_CSR_ACTION: 'Awaiting CSR',
  COMPLETED: 'Completed', FOLLOW_UP_REQUIRED: 'Follow-Up', CLOSED: 'Closed',
}
const ALL_STATUSES = Object.keys(STATUS_LABELS)

// â”€â”€ Exported helper components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function CoachingPurposeBadge({ purpose }: { purpose: CoachingPurpose }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      PURPOSE_STYLES[purpose] ?? 'bg-slate-100 text-slate-600')}>
      {PURPOSE_MAP[purpose] ?? purpose}
    </span>
  )
}

export function CoachingFormatBadge({ format }: { format: CoachingFormat }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      FORMAT_STYLES[format] ?? 'bg-slate-100 text-slate-600')}>
      {FORMAT_MAP[format] ?? format}
    </span>
  )
}

/** @deprecated kept for backward compat — use CoachingPurposeBadge */
export function CoachingTypeBadge({ type }: { type: CoachingPurpose }) {
  return <CoachingPurposeBadge purpose={type} />
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
  const quizCount   = Number((session as any).quiz_count  ?? session.quizzes?.length ?? 0)
  const passedCount = Number((session as any).quiz_passed_count ?? 0)
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

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// ── Date urgency helper ───────────────────────────────────────────────────────

export function dateUrgency(dateStr?: string | null): { label: string; cls: string } | null {
  if (!dateStr) return null
  const today = new Date().toISOString().slice(0, 10)
  const d     = dateStr.slice(0, 10)
  if (d === today) return { label: 'Today',                      cls: 'text-amber-600 font-semibold' }
  if (d  < today)  return { label: `${formatQualityDate(dateStr)} ⚠`, cls: 'text-red-600 font-semibold' }
  return               { label: formatQualityDate(dateStr),       cls: 'text-slate-600' }
}

export default function CoachingSessionsPage() {
  const navigate = useNavigate()
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const [dateField, setDateField] = useState<DateField>('session_date')

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    csrs: '', statuses: '', formats: '', topics: '',
    from: defaultFrom, to: defaultTo, overdue: '', dueToday: '', page: '1', size: '20',
  })

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
    queryKey: ['coaching-sessions', page, pageSize, dateField, dateFrom, dateTo, overdue, dueToday],
    queryFn: () => trainingService.getCoachingSessions({
      page,
      limit: pageSize,
      date_from:    dateField === 'session_date' ? (dateFrom || undefined) : undefined,
      date_to:      dateField === 'session_date' ? (dateTo   || undefined) : undefined,
      overdue_only: overdue   === 'true' ? true : undefined,
      due_today:    dueToday  === 'true' ? true : undefined,
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

  const formatOptions = Object.values(FORMAT_MAP)

  const clientFiltered = useMemo(() => {
    let items = data?.items ?? []
    if (selectedCsrs.length)     items = items.filter(s => selectedCsrs.includes(s.csr_name))
    if (selectedStatuses.length) items = items.filter(s => selectedStatuses.includes(STATUS_LABELS[s.status] ?? s.status))
    if (selectedFormats.length)  items = items.filter(s => selectedFormats.includes(FORMAT_MAP[s.coaching_format] ?? s.coaching_format))
    if (selectedTopics.length)   items = items.filter(s => s.topics.some(t => selectedTopics.includes(t)))
    // Client-side date filtering for due_date and follow_up_date
    if (dateField !== 'session_date' && (dateFrom || dateTo)) {
      items = items.filter(s => {
        const raw = dateField === 'due_date' ? s.due_date : s.follow_up_date
        if (!raw) return false
        const d = raw.slice(0, 10)
        if (dateFrom && d < dateFrom) return false
        if (dateTo   && d > dateTo)   return false
        return true
      })
    }
    return items
  }, [data?.items, selectedCsrs, selectedStatuses, selectedFormats, selectedTopics, dateField, dateFrom, dateTo])

  const { sort, dir, toggle, sorted: sortedItems } = useListSort(clientFiltered)

  const hasClientFilter = selectedCsrs.length > 0 || selectedStatuses.length > 0 || selectedFormats.length > 0 || selectedTopics.length > 0
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
        {/* ── Row 1: CSRs · Topics · Status ── */}
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
          options={statusOptions}
          selected={selectedStatuses}
          onApply={v => setMany({ statuses: v.join(','), page: '1' })}
          placeholder="All Statuses"
          width="w-[180px]"
        />

        {/* ── Row break ── */}
        <div className="w-full" />

        {/* ── Row 2: Format · Date field range · Overdue ── */}
        <StagedMultiSelect
          options={formatOptions}
          selected={selectedFormats}
          onApply={v => setMany({ formats: v.join(','), page: '1' })}
          placeholder="All Formats"
          width="w-[220px]"
        />
        <DateFieldRangeFilter
          field={dateField}
          start={dateFrom}
          end={dateTo}
          onFieldChange={f => { setDateField(f); setMany({ from: '', to: '', page: '1' }) }}
          onRangeChange={(s, e) => setMany({ from: s, to: e, page: '1' })}
        />
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={dueToday === 'true'}
            onChange={e => setMany({ dueToday: e.target.checked ? 'true' : '', overdue: '', page: '1' })}
            className="accent-primary h-4 w-4" />
          Due Today
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={overdue === 'true'}
            onChange={e => setMany({ overdue: e.target.checked ? 'true' : '', dueToday: '', page: '1' })}
            className="accent-primary h-4 w-4" />
          Overdue
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
              <StandardTableHeaderRow>
                <SortableTableHead field="session_date"  sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Date</SortableTableHead>
                <SortableTableHead field="status"        sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Status</SortableTableHead>
                <SortableTableHead field="csr_name"      sort={sort} dir={dir} onSort={toggle} className="min-w-[200px]">CSR</SortableTableHead>
                <TableHead className="min-w-[120px]">Purpose</TableHead>
                <TableHead className="min-w-[120px]">Format</TableHead>
                <TableHead className="min-w-[160px]">Topics</TableHead>
                <TableHead className="min-w-[130px]">Quiz</TableHead>
                <SortableTableHead field="due_date"       sort={sort} dir={dir} onSort={toggle} className="min-w-[130px] pl-6">Due Date</SortableTableHead>
                <SortableTableHead field="follow_up_date" sort={sort} dir={dir} onSort={toggle} className="min-w-[150px] pl-6">Follow-Up Date</SortableTableHead>
                <TableHead className="w-24" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {sortedItems.length === 0 ? (
                <TableEmptyState
                  colSpan={10}
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
                  <TableCell className="text-[13px] text-slate-600">{STATUS_LABELS[s.status] ?? s.status}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-slate-900">{s.csr_name}</span>
                      {(s.repeat_topics?.length ?? 0) > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-orange-500 text-xs cursor-help select-none">🔥</span>
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
                  <TableCell className="pl-6 text-[13px] whitespace-nowrap">
                    {(() => { const u = dateUrgency(s.due_date); return u ? <span className={u.cls}>{u.label}</span> : <span className="text-slate-300">&mdash;</span> })()}
                  </TableCell>
                  <TableCell className="pl-6 text-[13px] whitespace-nowrap">
                    {(() => { const u = dateUrgency(s.follow_up_date); return u ? <span className={u.cls}>{u.label}</span> : <span className="text-slate-300">&mdash;</span> })()}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                      onClick={() => navigate(`/app/training/coaching/${s.id}`)}
                    >
                      <Eye className="h-3.5 w-3.5" /> View
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


