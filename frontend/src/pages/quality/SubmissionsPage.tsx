import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, Eye, Search } from 'lucide-react'
import qaService, { type Submission } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { useQualityRole } from '@/hooks/useQualityRole'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { RowActionButton } from '@/components/common/RowActionButton'
import { formatQualityDate as fmtDate, defaultDateRange90 } from '@/utils/dateFormat'
import { SUBMISSION_STATUSES, CLIENT_FETCH_LIMIT } from '@/constants/labels'

export default function SubmissionsPage() {
  const navigate = useNavigate()
  const { roleId, isAdminOrQA, isManager, isAgent } = useQualityRole()

  const pageTitle = isAgent ? 'My Reviews' : isManager ? 'Completed Reviews' : 'Completed Forms'

  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    forms: '', agents: '', statuses: '', from: defaultFrom, to: defaultTo, reviewId: '', page: '1', size: '20',
  })

  const formsParam    = get('forms')
  const agentsParam   = get('agents')
  const statusesParam = get('statuses')
  const dateFrom      = get('from')
  const dateTo        = get('to')
  const reviewId      = get('reviewId')
  const page          = parseInt(get('page')) || 1
  const pageSize      = parseInt(get('size')) || 20

  const selectedFormNames  = useMemo(() => formsParam  ? formsParam.split(',').filter(Boolean)  : [], [formsParam])
  const selectedAgentNames = useMemo(() => agentsParam ? agentsParam.split(',').filter(Boolean) : [], [agentsParam])
  const selectedStatuses   = useMemo(() => statusesParam ? statusesParam.split(',').filter(Boolean) : [], [statusesParam])

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  // Fetch ALL rows for the date range in one call — filtering + pagination is client-side
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['submissions', roleId, dateFrom, dateTo],
    queryFn: () => {
      const ds = dateFrom || undefined
      const de = dateTo   || undefined
      if (isAgent)   return qaService.getCSRAudits({ page: 1, limit: 5000, start_date: ds, end_date: de })
      if (isManager) return qaService.getTeamAudits({ page: 1, limit: 5000, start_date: ds, end_date: de })
      return qaService.getSubmissions({ page: 1, limit: 5000, date_start: ds, date_end: de })
    },
    enabled: roleId > 0,
    placeholderData: (prev) => prev,
  })

  const allItems = data?.items ?? []

  // Dropdown options from the FULL result set (all items in date range)
  const formNameOptions = useMemo(() => {
    return Array.from(new Set(allItems.map((r: Submission) => r.form_name).filter(Boolean))).sort() as string[]
  }, [allItems])

  const agentNameOptions = useMemo(() => {
    return Array.from(new Set(allItems.map((r: Submission) => r.csr_name).filter(Boolean))).sort() as string[]
  }, [allItems])

  const statusOptions = useMemo(() => {
    const present = new Set(allItems.map((r: Submission) => r.status).filter(Boolean))
    return SUBMISSION_STATUSES.filter(s => present.has(s))
  }, [allItems])

  // Client-side filtering on the full result set
  const filtered = useMemo(() => {
    let items = allItems
    if (reviewId) items = items.filter(r => String(r.id).includes(reviewId))
    if (selectedFormNames.length) items = items.filter(r => selectedFormNames.includes(r.form_name ?? ''))
    if (selectedAgentNames.length) items = items.filter(r => selectedAgentNames.includes(r.csr_name ?? ''))
    if (selectedStatuses.length)  items = items.filter(r => selectedStatuses.includes(r.status))
    return items
  }, [allItems, reviewId, selectedFormNames, selectedAgentNames, selectedStatuses])

  const { sort, dir, toggle, sorted } = useListSort(filtered)

  // Client-side pagination on filtered + sorted results
  const totalPages  = Math.max(1, Math.ceil(sorted.length / pageSize))
  const sortedItems = sorted.slice((page - 1) * pageSize, page * pageSize)
  const hasFilters  = hasAnyFilter

  const colSpan = isAdminOrQA ? 8 : isManager ? 7 : 6

  return (
    <ListPageShell>
      <ListPageHeader title={pageTitle} />

      <ListFilterBar
        hasFilters={hasFilters}
        onReset={reset}
        resultCount={{ total: filtered.length }}
        truncated={allItems.length >= CLIENT_FETCH_LIMIT}
      >
        {/* 1. Forms */}
        <StagedMultiSelect
          options={formNameOptions}
          selected={selectedFormNames}
          onApply={names => setMany({ forms: names.join(','), page: '1' })}
          placeholder="All Forms"
          width="w-[340px]"
        />

        {/* 2. Agent Name */}
        {!isAgent && agentNameOptions.length > 0 && (
          <StagedMultiSelect
            options={agentNameOptions}
            selected={selectedAgentNames}
            onApply={names => setMany({ agents: names.join(','), page: '1' })}
            placeholder="All Agents"
            width="w-[200px]"
          />
        )}

        {/* 3. Status — options derived from current results, submission-level only */}
        <StagedMultiSelect
          options={statusOptions.map(s => s.charAt(0) + s.slice(1).toLowerCase())}
          selected={selectedStatuses.map(s => s.charAt(0) + s.slice(1).toLowerCase())}
          onApply={names => setMany({
            statuses: names.map(n => n.toUpperCase()).join(','),
            page: '1',
          })}
          placeholder="All Statuses"
          width="w-[160px]"
        />

        {/* Line break — date + search on second row */}
        <div className="basis-full" />

        {/* 4. Date range */}
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={v => setMany({ from: v.start, to: v.end, page: '1' })}
        />

        {/* 5. Review # search */}
        <div className="relative w-[150px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Review #"
            value={reviewId}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '')
              setMany({ reviewId: v, page: '1' })
            }}
            className="pl-8 h-9 text-[13px]"
          />
        </div>
      </ListFilterBar>

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load submissions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="id"              sort={sort} dir={dir} onSort={toggle} className="w-[100px]">Review #</SortableTableHead>
                <SortableTableHead field="status"          sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <SortableTableHead field="form_name"       sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                {!isAgent    && <SortableTableHead field="csr_name"      sort={sort} dir={dir} onSort={toggle}>Agent</SortableTableHead>}
                <SortableTableHead field="created_at"      sort={sort} dir={dir} onSort={toggle} className="pl-6">Review Date</SortableTableHead>
                <SortableTableHead field="interaction_date" sort={sort} dir={dir} onSort={toggle} className="pl-6">Interaction Date</SortableTableHead>
                <SortableTableHead field="score"           sort={sort} dir={dir} onSort={toggle}>Score</SortableTableHead>
                <TableHead className="w-20" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {sortedItems.length ? (
                sortedItems.map((row: Submission) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/quality/submissions/${row.id}`, {
                      state: { from: pageTitle, fromPath: '/app/quality/submissions' },
                    })}>
                    <TableCell className="text-[13px] text-slate-500">{row.id}</TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-600">{row.form_name}</TableCell>
                    {!isAgent    && <TableCell className="text-[13px] text-slate-600">{row.csr_name ?? '—'}</TableCell>}
                    <TableCell className="text-[13px] text-slate-600 pl-6">{fmtDate(row.created_at)}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 pl-6">{row.interaction_date ? fmtDate(row.interaction_date) : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        {row.score != null && row.score > 0
                          ? `${row.score.toFixed(1)}%`
                          : <span className="text-slate-400">—</span>
                        }
                        {(row.critical_fail_count ?? 0) > 0 && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  onClick={e => e.stopPropagation()}
                                  aria-label="Critical fail on this review"
                                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold leading-none"
                                >
                                  !
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-xs leading-snug">
                                {row.score_capped
                                  ? `Critical fail (${row.critical_fail_count} miss${row.critical_fail_count === 1 ? '' : 'es'}) — score capped`
                                  : `Critical fail (${row.critical_fail_count} miss${row.critical_fail_count === 1 ? '' : 'es'})`}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="pl-2">
                      <RowActionButton icon={Eye}
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/app/quality/submissions/${row.id}`, {
                            state: { from: pageTitle, fromPath: '/app/quality/submissions' },
                          })
                        }}>
                        View
                      </RowActionButton>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={colSpan}
                  icon={FileText}
                  title="No submissions found."
                  action={hasFilters ? { label: 'Clear filters', onClick: reset } : undefined}
                />
              )}
            </TableBody>
          </Table>
        )}
      </ListCard>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={filtered.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </ListPageShell>
  )
}
