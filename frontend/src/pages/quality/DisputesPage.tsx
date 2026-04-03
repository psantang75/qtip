import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye } from 'lucide-react'
import { useQualityRole } from '@/hooks/useQualityRole'
import qaService, { type DisputeRecord, type DisputeHistoryItem } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate as fmtDate, defaultDateRange90 } from '@/utils/dateFormat'

// Dispute-level statuses only
const DISPUTE_STATUSES = ['OPEN', 'UPHELD', 'ADJUSTED']

const DEFAULT_PAGE_SIZE = 20


/** Normalize CSR dispute history items to the shared DisputeRecord shape */
function normalizeCsrItem(d: DisputeHistoryItem): DisputeRecord {
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
  const { isCSR } = useQualityRole()

  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange90())

  // Multi-select filter state — staged via StagedMultiSelect, applied on click
  const [selectedFormNames,     setSelectedFormNames]     = useState<string[]>([])
  const [selectedCsrNames,      setSelectedCsrNames]      = useState<string[]>([])
  const [selectedReviewerNames, setSelectedReviewerNames] = useState<string[]>([])
  const [selectedStatuses,      setSelectedStatuses]      = useState<string[]>([])

  // For admin/manager: single status passed to API; multiple handled client-side
  const apiStatus = !isCSR && selectedStatuses.length === 1 ? selectedStatuses[0] : undefined

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['disputes', isCSR, isCSR ? 'all' : page, isCSR ? 500 : pageSize, apiStatus, isCSR ? null : dateRange],
    queryFn: async () => {
      if (isCSR) {
        // Fetch all at once so date/form/status filtering and pagination are fully client-side
        const res = await qaService.getCSRDisputeHistory({ page: 1, limit: 500 })
        return { ...res, items: res.items.map(normalizeCsrItem) }
      }
      return qaService.getManagerDisputes({
        page, limit: pageSize,
        status:    apiStatus,
        startDate: dateRange.start || undefined,
        endDate:   dateRange.end   || undefined,
      })
    },
    placeholderData: (prev) => prev,
  })

  // For CSR: apply all filters client-side (date, form, status)
  // For admin/manager: server already filtered by date/status; apply multi-select filters here
  const clientFiltered = useMemo(() => {
    let items: DisputeRecord[] = data?.items ?? []

    // Date — CSR only (admin/manager filtered server-side)
    if (isCSR) {
      if (dateRange.start) items = items.filter(d => (d.created_at ?? '').split('T')[0] >= dateRange.start)
      if (dateRange.end)   items = items.filter(d => (d.created_at ?? '').split('T')[0] <= dateRange.end)
    }

    if (selectedFormNames.length > 0)
      items = items.filter(d => selectedFormNames.includes(d.form_name ?? ''))
    if (selectedCsrNames.length > 0)
      items = items.filter(d => selectedCsrNames.includes(d.csr_name ?? ''))
    if (selectedReviewerNames.length > 0)
      items = items.filter(d => selectedReviewerNames.includes(d.qa_analyst_name ?? ''))
    if (selectedStatuses.length > 0)
      items = items.filter(d => selectedStatuses.includes(d.status))

    return items
  }, [data?.items, isCSR, dateRange, selectedFormNames, selectedCsrNames, selectedReviewerNames, selectedStatuses])

  // Derive dropdown options from the date-filtered set (before form/status filters)
  // so options always reflect what's in the current date window
  const dateFiltered = useMemo(() => {
    if (!isCSR) return data?.items ?? []
    let items: DisputeRecord[] = data?.items ?? []
    if (dateRange.start) items = items.filter(d => (d.created_at ?? '').split('T')[0] >= dateRange.start)
    if (dateRange.end)   items = items.filter(d => (d.created_at ?? '').split('T')[0] <= dateRange.end)
    return items
  }, [data?.items, isCSR, dateRange])

  const formNameOptions = useMemo(() => {
    const s = new Set(dateFiltered.map((d: DisputeRecord) => d.form_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [dateFiltered])

  const csrNameOptions = useMemo(() => {
    const s = new Set(dateFiltered.map((d: DisputeRecord) => d.csr_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [dateFiltered])

  const reviewerNameOptions = useMemo(() => {
    const s = new Set(dateFiltered.map((d: DisputeRecord) => d.qa_analyst_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [dateFiltered])

  const statusOptions = useMemo(() => {
    const present = new Set(dateFiltered.map((d: DisputeRecord) => d.status).filter(Boolean))
    return DISPUTE_STATUSES.filter(s => present.has(s))
  }, [dateFiltered])

  const { sort, dir, toggle, sorted } = useListSort(clientFiltered)

  // Pagination — CSR is fully client-side; admin/manager is server-side
  const csrTotalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const totalPages    = isCSR
    ? csrTotalPages
    : (data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / pageSize) : 1))
  const displayedItems = isCSR
    ? sorted.slice((page - 1) * pageSize, page * pageSize)
    : sorted
  const resultTotal = isCSR ? sorted.length : (data?.total ?? 0)

  const hasFilters =
    selectedFormNames.length > 0 ||
    selectedCsrNames.length > 0 ||
    selectedReviewerNames.length > 0 ||
    selectedStatuses.length > 0 ||
    dateRange.start !== defaultDateRange90().start ||
    dateRange.end   !== defaultDateRange90().end

  const resetFilters = () => {
    setSelectedFormNames([])
    setSelectedCsrNames([])
    setSelectedReviewerNames([])
    setSelectedStatuses([])
    setDateRange(defaultDateRange90())
    setPage(1)
    setPageSize(DEFAULT_PAGE_SIZE)
  }

  const fromLabel = isCSR ? 'Dispute History' : 'Disputes'
  const fromPath  = '/app/quality/disputes'
  const colSpan   = isCSR ? 8 : 10

  return (
    <QualityListPage>
      <QualityPageHeader title={fromLabel} />

      <QualityFilterBar
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: resultTotal }}
      >
        {/* 1. Forms */}
        <StagedMultiSelect
          options={formNameOptions}
          selected={selectedFormNames}
          onApply={v => { setSelectedFormNames(v); setPage(1) }}
          placeholder="All Forms"
          width="w-[340px]"
        />

        {/* 2. CSR — hidden for CSR role (they only see their own) */}
        {!isCSR && csrNameOptions.length > 0 && (
          <StagedMultiSelect
            options={csrNameOptions}
            selected={selectedCsrNames}
            onApply={v => { setSelectedCsrNames(v); setPage(1) }}
            placeholder="All CSRs"
            width="w-[200px]"
          />
        )}

        {/* 3. Reviewer */}
        {!isCSR && reviewerNameOptions.length > 0 && (
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

        {/* 5. Date range */}
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load disputes." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="status"           sort={sort} dir={dir} onSort={toggle} className="w-24">Status</SortableTableHead>
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                {!isCSR && <SortableTableHead field="csr_name" sort={sort} dir={dir} onSort={toggle} className="w-40">CSR</SortableTableHead>}
                <SortableTableHead field="submission_id"    sort={sort} dir={dir} onSort={toggle} className="w-20">Review #</SortableTableHead>
                <SortableTableHead field="id"               sort={sort} dir={dir} onSort={toggle} className="w-20">Dispute #</SortableTableHead>
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={toggle} className="w-28">Review Date</SortableTableHead>
                <SortableTableHead field="interaction_date" sort={sort} dir={dir} onSort={toggle} className="w-28">Int. Date</SortableTableHead>
                <SortableTableHead field="original_score"   sort={sort} dir={dir} onSort={toggle} className="w-20" right>Score</SortableTableHead>
                <SortableTableHead field="adjusted_score"   sort={sort} dir={dir} onSort={toggle} className="w-24" right>Adj. Score</SortableTableHead>
                <TableHead className="w-16" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {displayedItems.length ? (
                displayedItems.map((d: DisputeRecord) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`, {
                      state: { from: fromLabel, fromPath },
                    })}>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{d.form_name ?? '—'}</TableCell>
                    {!isCSR && <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{d.csr_name ?? '—'}</TableCell>}
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">#{d.submission_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-500 whitespace-nowrap">#{d.id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{fmtDate(d.created_at)}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{d.interaction_date ? fmtDate(d.interaction_date) : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-right pr-4 text-[13px] font-medium text-slate-700 whitespace-nowrap">
                      {d.original_score != null && d.original_score > 0
                        ? `${d.original_score.toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right pr-4 text-[13px] text-slate-600 whitespace-nowrap">
                      {d.adjusted_score != null && d.adjusted_score > 0
                        ? `${Number(d.adjusted_score).toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="pl-2">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/app/quality/submissions/${d.submission_id}`, {
                            state: { from: fromLabel, fromPath },
                          })
                        }}>
                        <Eye size={12} className="mr-1" />
                        {!isCSR && d.status === 'OPEN' ? 'Resolve' : 'View'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={colSpan}
                  icon={AlertTriangle}
                  title={hasFilters ? 'No disputes match your filters.' : isCSR ? 'You have no dispute history yet.' : 'No disputes found.'}
                  action={hasFilters ? { label: 'Clear filters', onClick: resetFilters } : undefined}
                />
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={resultTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </QualityListPage>
  )
}

export default function DisputesPage() {
  return <DisputeListView />
}
