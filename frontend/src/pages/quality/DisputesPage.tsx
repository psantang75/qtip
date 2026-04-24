import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye } from 'lucide-react'
import { useQualityRole } from '@/hooks/useQualityRole'
import qaService, { type DisputeRecord, type DisputeHistoryItem } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { StatusBadge } from '@/components/common/StatusBadge'
import { IdSearchInput } from '@/components/common/IdSearchInput'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { RowActionButton } from '@/components/common/RowActionButton'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate as fmtDate, defaultDateRange90 } from '@/utils/dateFormat'
import { DISPUTE_STATUSES, CLIENT_FETCH_LIMIT } from '@/constants/labels'

const DEFAULT_PAGE_SIZE = 20


/** Normalize agent dispute history items to the shared DisputeRecord shape */
function normalizeAgentItem(d: DisputeHistoryItem): DisputeRecord {
  return {
    id:             d.dispute_id,
    submission_id:  d.audit_id,
    reason:         '',
    status:         d.status as DisputeRecord['status'],
    resolution_notes: d.resolution_notes ?? undefined,
    original_score: d.score,
    new_score:      d.adjusted_score ?? undefined,
    previous_score: d.previous_score,
    created_at:     d.created_at,
    form_name:      d.form_name,
  }
}

function DisputeListView() {
  const navigate = useNavigate()
  const { isAgent } = useQualityRole()

  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange90())

  // Multi-select filter state — staged via StagedMultiSelect, applied on click
  const [selectedFormNames,     setSelectedFormNames]     = useState<string[]>([])
  const [selectedAgentNames,    setSelectedAgentNames]    = useState<string[]>([])
  const [selectedReviewerNames, setSelectedReviewerNames] = useState<string[]>([])
  const [selectedStatuses,      setSelectedStatuses]      = useState<string[]>([])
  const [disputeId,             setDisputeId]             = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['disputes', isAgent, dateRange.start, dateRange.end],
    queryFn: async () => {
      if (isAgent) {
        const res = await qaService.getCSRDisputeHistory({ page: 1, limit: CLIENT_FETCH_LIMIT })
        return { ...res, items: res.items.map(normalizeAgentItem) }
      }
      return qaService.getManagerDisputes({
        page: 1, limit: CLIENT_FETCH_LIMIT,
        startDate: dateRange.start || undefined,
        endDate:   dateRange.end   || undefined,
      })
    },
    placeholderData: (prev) => prev,
  })

  const allItems = useMemo(() => {
    let items: DisputeRecord[] = data?.items ?? []
    if (isAgent) {
      if (dateRange.start) items = items.filter(d => (d.created_at ?? '').split('T')[0] >= dateRange.start)
      if (dateRange.end)   items = items.filter(d => (d.created_at ?? '').split('T')[0] <= dateRange.end)
    }
    return items
  }, [data?.items, isAgent, dateRange])

  const clientFiltered = useMemo(() => {
    let items = allItems
    if (disputeId)
      items = items.filter(d => String(d.id).includes(disputeId))
    if (selectedFormNames.length > 0)
      items = items.filter(d => selectedFormNames.includes(d.form_name ?? ''))
    if (selectedAgentNames.length > 0)
      items = items.filter(d => selectedAgentNames.includes(d.csr_name ?? ''))
    if (selectedReviewerNames.length > 0)
      items = items.filter(d => selectedReviewerNames.includes(d.qa_analyst_name ?? ''))
    if (selectedStatuses.length > 0)
      items = items.filter(d => selectedStatuses.includes(d.status))
    return items
  }, [allItems, disputeId, selectedFormNames, selectedAgentNames, selectedReviewerNames, selectedStatuses])

  const formNameOptions = useMemo(() => {
    const s = new Set(allItems.map((d: DisputeRecord) => d.form_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [allItems])

  const agentNameOptions = useMemo(() => {
    const s = new Set(allItems.map((d: DisputeRecord) => d.csr_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [allItems])

  const reviewerNameOptions = useMemo(() => {
    const s = new Set(allItems.map((d: DisputeRecord) => d.qa_analyst_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [allItems])

  const statusOptions = useMemo(() => {
    const present = new Set(allItems.map((d: DisputeRecord) => d.status).filter(Boolean))
    return DISPUTE_STATUSES.filter(s => present.has(s))
  }, [allItems])

  const { sort, dir, toggle, sorted } = useListSort(clientFiltered)

  const totalPages    = Math.max(1, Math.ceil(sorted.length / pageSize))
  const displayedItems = sorted.slice((page - 1) * pageSize, page * pageSize)
  const resultTotal = sorted.length

  const hasFilters =
    disputeId.length > 0 ||
    selectedFormNames.length > 0 ||
    selectedAgentNames.length > 0 ||
    selectedReviewerNames.length > 0 ||
    selectedStatuses.length > 0 ||
    dateRange.start !== defaultDateRange90().start ||
    dateRange.end   !== defaultDateRange90().end

  const resetFilters = () => {
    setDisputeId('')
    setSelectedFormNames([])
    setSelectedAgentNames([])
    setSelectedReviewerNames([])
    setSelectedStatuses([])
    setDateRange(defaultDateRange90())
    setPage(1)
    setPageSize(DEFAULT_PAGE_SIZE)
  }

  const fromLabel = isAgent ? 'Dispute History' : 'Disputes'
  const fromPath  = '/app/quality/disputes'
  const colSpan   = isAgent ? 8 : 10

  return (
    <ListPageShell>
      <ListPageHeader title={fromLabel} />

      <ListFilterBar
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: resultTotal }}
        truncated={(data?.items ?? []).length >= CLIENT_FETCH_LIMIT}
      >
        {/* 1. Forms */}
        <StagedMultiSelect
          options={formNameOptions}
          selected={selectedFormNames}
          onApply={v => { setSelectedFormNames(v); setPage(1) }}
          placeholder="All Forms"
          width="w-[340px]"
        />

        {/* 2. Agent — hidden for Agent role (they only see their own) */}
        {!isAgent && agentNameOptions.length > 0 && (
          <StagedMultiSelect
            options={agentNameOptions}
            selected={selectedAgentNames}
            onApply={v => { setSelectedAgentNames(v); setPage(1) }}
            placeholder="All Agents"
            width="w-[200px]"
          />
        )}

        {/* 3. Reviewer */}
        {!isAgent && reviewerNameOptions.length > 0 && (
          <StagedMultiSelect
            options={reviewerNameOptions}
            selected={selectedReviewerNames}
            onApply={v => { setSelectedReviewerNames(v); setPage(1) }}
            placeholder="All Reviewers"
            width="w-[200px]"
          />
        )}

        {/* 4. Status */}
        <StagedMultiSelect
          options={statusOptions.map(s => s.charAt(0) + s.slice(1).toLowerCase())}
          selected={selectedStatuses.map(s => s.charAt(0) + s.slice(1).toLowerCase())}
          onApply={names => {
            setSelectedStatuses(names.map(n => n.toUpperCase()))
            setPage(1)
          }}
          placeholder="All Statuses"
          width="w-[160px]"
        />

        {/* Line break — date + search on second row */}
        <div className="basis-full" />

        {/* 5. Date range */}
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />

        {/* 6. Dispute # search */}
        <IdSearchInput
          value={disputeId}
          onChange={v => { setDisputeId(v); setPage(1) }}
          placeholder="Dispute #"
        />
      </ListFilterBar>

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load disputes." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="id"               sort={sort} dir={dir} onSort={toggle} className="w-[75px]">Dispute #</SortableTableHead>
                <SortableTableHead field="submission_id"    sort={sort} dir={dir} onSort={toggle} className="w-[75px]">Review #</SortableTableHead>
                <SortableTableHead field="status"           sort={sort} dir={dir} onSort={toggle} className="w-[70px]">Status</SortableTableHead>
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={toggle} className="w-[230px]">Form Name</SortableTableHead>
                {!isAgent && <SortableTableHead field="csr_name" sort={sort} dir={dir} onSort={toggle} className="w-[170px]">Agent</SortableTableHead>}
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={toggle} className="w-[95px]">Review Date</SortableTableHead>
                <SortableTableHead field="interaction_date" sort={sort} dir={dir} onSort={toggle} className="w-[95px]">Int. Date</SortableTableHead>
                <SortableTableHead field="original_score"   sort={sort} dir={dir} onSort={toggle} className="w-[65px]" right>Score</SortableTableHead>
                <SortableTableHead field="adjusted_score"   sort={sort} dir={dir} onSort={toggle} className="w-[80px]" right>Adj. Score</SortableTableHead>
                <TableHead className="w-[85px] pl-8" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {displayedItems.length ? (
                displayedItems.map((d: DisputeRecord) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`, {
                      state: { from: fromLabel, fromPath },
                    })}>
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">#{d.id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">#{d.submission_id ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.form_name ?? '—'}</TableCell>
                    {!isAgent && <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{d.csr_name ?? '—'}</TableCell>}
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{fmtDate(d.created_at)}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{d.interaction_date ? fmtDate(d.interaction_date) : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-right text-[13px] text-slate-600 whitespace-nowrap">
                      {d.original_score != null && d.original_score > 0
                        ? `${d.original_score.toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-slate-600 whitespace-nowrap">
                      {d.adjusted_score != null && d.adjusted_score > 0
                        ? `${Number(d.adjusted_score).toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="pl-8">
                      <RowActionButton icon={Eye}
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/app/quality/submissions/${d.submission_id}`, {
                            state: { from: fromLabel, fromPath },
                          })
                        }}>
                        {!isAgent && d.status === 'OPEN' ? 'Resolve' : 'View'}
                      </RowActionButton>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={colSpan}
                  icon={AlertTriangle}
                  title={hasFilters ? 'No disputes match your filters.' : isAgent ? 'You have no dispute history yet.' : 'No disputes found.'}
                  action={hasFilters ? { label: 'Clear filters', onClick: resetFilters } : undefined}
                />
              )}
            </TableBody>
          </Table>
        )}
      </ListCard>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={resultTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </ListPageShell>
  )
}

export default function DisputesPage() {
  return <DisputeListView />
}
