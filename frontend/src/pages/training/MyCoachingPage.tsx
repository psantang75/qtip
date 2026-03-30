import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Eye } from 'lucide-react'
import trainingService from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { DateFieldRangeFilter, type DateField } from '@/components/common/DateFieldRangeFilter'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ListPagination } from '@/components/common/ListPagination'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate, defaultDateRange90 } from '@/utils/dateFormat'
import { QuizStatusBadge, PURPOSE_MAP, FORMAT_MAP, STATUS_LABELS, dateUrgency } from './CoachingSessionsPage'


const SORT_PRIORITY: Record<string, number> = { IN_PROCESS: 0, AWAITING_CSR_ACTION: 0 }

export default function MyCoachingPage() {
  const navigate = useNavigate()

  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [topicFilter,  setTopicFilter]  = useState<string[]>([])
  const [dateField,    setDateField]    = useState<DateField>('session_date')
  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])
  const [dateFrom,     setDateFrom]     = useState(defaultFrom)
  const [dateTo,       setDateTo]       = useState(defaultTo)
  const [overdueOnly,  setOverdueOnly]  = useState(false)
  const [dueTodayOnly, setDueTodayOnly] = useState(false)
  const [page,         setPage]         = useState(1)
  const [pageSize,     setPageSize]     = useState(20)

  const handleRangeChange = useCallback((s: string, e: string) => { setDateFrom(s); setDateTo(e); setPage(1) }, [])
  const handleFieldChange = useCallback((f: DateField) => { setDateField(f); setDateFrom(''); setDateTo(''); setPage(1) }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['my-coaching'],
    queryFn:  () => trainingService.getMyCoachingSessions({ limit: 100 }),
  })

  const allSessions = data?.items ?? []

  // Base filter (search only) — used to derive available filter options
  const baseFiltered = useMemo(() => allSessions, [allSessions])

  const filtered = useMemo(() => {
    let items = baseFiltered
    if (statusFilter.length) items = items.filter(s => statusFilter.includes(STATUS_LABELS[s.status] ?? s.status))
    if (topicFilter.length)  items = items.filter(s => topicFilter.some(t => s.topics.includes(t)))
    if (dateFrom || dateTo) {
      items = items.filter(s => {
        const raw = dateField === 'session_date' ? s.session_date
                  : dateField === 'due_date'     ? s.due_date
                  : s.follow_up_date
        if (!raw) return false
        const d = raw.slice(0, 10)
        if (dateFrom && d < dateFrom) return false
        if (dateTo   && d > dateTo)   return false
        return true
      })
    }
    if (dueTodayOnly) {
      const today = new Date().toISOString().slice(0, 10)
      items = items.filter(s =>
        s.session_date?.slice(0, 10) === today ||
        s.due_date?.slice(0, 10)     === today ||
        s.follow_up_date?.slice(0, 10) === today
      )
    }
    if (overdueOnly) {
      const today = new Date().toISOString().slice(0, 10)
      items = items.filter(s =>
        (s.due_date       && s.due_date.slice(0, 10)       < today && !['COMPLETED','CLOSED'].includes(s.status)) ||
        (s.follow_up_date && s.follow_up_date.slice(0, 10) < today && s.status === 'FOLLOW_UP_REQUIRED')
      )
    }
    // Default sort: needs-response first, then by due date
    return [...items].sort((a, b) => {
      const diff = (SORT_PRIORITY[a.status] ?? 2) - (SORT_PRIORITY[b.status] ?? 2)
      if (diff !== 0) return diff
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity
      return ad - bd
    })
  }, [baseFiltered, statusFilter, topicFilter, dateField, dateFrom, dateTo, overdueOnly])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const sessions   = sorted.slice((page - 1) * pageSize, page * pageSize)

  // Filter option lists derived from base-filtered results
  const statusOptions = useMemo(() => [...new Set(baseFiltered.map(s => STATUS_LABELS[s.status] ?? s.status))].sort(), [baseFiltered])
  const topicOptions  = useMemo(() => {
    const all = baseFiltered.flatMap(s => s.topics)
    return [...new Set(all)].sort()
  }, [baseFiltered])

  const hasFilters = statusFilter.length > 0 || topicFilter.length > 0 || !!dateFrom || !!dateTo || overdueOnly || dueTodayOnly

  return (
    <QualityListPage>
      <QualityPageHeader title="My Coaching" />


      <QualityFilterBar
        hasFilters={hasFilters}
        onReset={() => { setStatusFilter([]); setTopicFilter([]); setDateFrom(defaultFrom); setDateTo(defaultTo); setOverdueOnly(false); setDueTodayOnly(false); setPage(1) }}
        resultCount={{ filtered: sorted.length, total: allSessions.length }}
      >
        {/* ── Row 1: Status · Topics ── */}
        <StagedMultiSelect
          options={statusOptions}
          selected={statusFilter}
          onApply={v => { setStatusFilter(v); setPage(1) }}
          placeholder="All Statuses"
          width="w-[200px]"
        />
        <StagedMultiSelect
          options={topicOptions}
          selected={topicFilter}
          onApply={v => { setTopicFilter(v); setPage(1) }}
          placeholder="All Topics"
          width="w-[280px]"
        />

        {/* ── Row break ── */}
        <div className="w-full" />

        {/* ── Row 2: Date field range · Overdue ── */}
        <DateFieldRangeFilter
          field={dateField}
          start={dateFrom}
          end={dateTo}
          onFieldChange={handleFieldChange}
          onRangeChange={handleRangeChange}
        />
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={dueTodayOnly}
            onChange={e => { setDueTodayOnly(e.target.checked); if (e.target.checked) setOverdueOnly(false); setPage(1) }}
            className="accent-primary h-4 w-4" />
          Due Today
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={overdueOnly}
            onChange={e => { setOverdueOnly(e.target.checked); if (e.target.checked) setDueTodayOnly(false); setPage(1) }}
            className="accent-primary h-4 w-4" />
          Overdue
        </label>
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={5} />
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
                  title="No coaching sessions found"
                  description={hasFilters ? 'Try adjusting your filters' : 'Your sessions will appear here'} />
              ) : sessions.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/training/my-coaching/${s.id}`)}>

                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {formatQualityDate(s.session_date)}
                  </TableCell>

                  <TableCell className="text-[13px] text-slate-600">
                    {STATUS_LABELS[s.status] ?? s.status}
                  </TableCell>

                  <TableCell className="text-[13px] text-slate-600">
                    {PURPOSE_MAP[s.coaching_purpose] ?? s.coaching_purpose}
                  </TableCell>

                  <TableCell className="text-[13px] text-slate-600">
                    {FORMAT_MAP[s.coaching_format] ?? s.coaching_format}
                  </TableCell>

                  {/* Topics with tooltip */}
                  <TableCell className="max-w-[200px]">
                    {s.topics.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[13px] text-slate-500 truncate block max-w-[200px] cursor-default">
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
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                      onClick={() => navigate(`/app/training/my-coaching/${s.id}`)}>
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
        totalPages={totalPages}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />
    </QualityListPage>
  )
}
