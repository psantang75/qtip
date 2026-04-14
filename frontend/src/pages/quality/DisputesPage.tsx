import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye, Search } from 'lucide-react'
import { useQualityRole } from '@/hooks/useQualityRole'
import qaService, { type DisputeRecord, type DisputeHistoryItem } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate as fmtDate, defaultDateRange90 } from '@/utils/dateFormat'
import { DISPUTE_STATUSES, STATUS_LABELS, CLIENT_FETCH_LIMIT } from '@/constants/labels'

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
  const [disputeId,             setDisputeId]             = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['disputes', isCSR, dateRange.start, dateRange.end],
    queryFn: async () => {
      if (isCSR) {
        const res = await qaService.getCSRDisputeHistory({ page: 1, limit: 5000 })
        return { ...res, items: res.items.map(normalizeCsrItem) }
      }
      return qaService.getManagerDisputes({
        page: 1, limit: 5000,
        startDate: dateRange.start || undefined,
        endDate:   dateRange.end   || undefined,
      })
    },
    placeholderData: (prev) => prev,
  })

  const allItems = useMemo(() => {
    let items: DisputeRecord[] = data?.items ?? []
    if (isCSR) {
      if (dateRange.start) items = items.filter(d => (d.created_at ?? '').split('T')[0] >= dateRange.start)
      if (dateRange.end)   items = items.filter(d => (d.created_at ?? '').split('T')[0] <= dateRange.end)
    }
    return items
  }, [data?.items, isCSR, dateRange])

  const clientFiltered = useMemo(() => {
    let items = allItems
    if (disputeId)
      items = items.filter(d => String(d.id).includes(disputeId))
    if (selectedFormNames.length > 0)
      items = items.filter(d => selectedFormNames.includes(d.form_name ?? ''))
    if (selectedCsrNames.length > 0)
      items = items.filter(d => selectedCsrNames.includes(d.csr_name ?? ''))
    if (selectedReviewerNames.length > 0)
      items = items.filter(d => selectedReviewerNames.includes(d.qa_analyst_name ?? ''))
    if (selectedStatuses.length > 0)
      items = items.filter(d => selectedStatuses.includes(d.status))
    return items
  }, [allItems, disputeId, selectedFormNames, selectedCsrNames, selectedReviewerNames, selectedStatuses])

  const formNameOptions = useMemo(() => {
    const s = new Set(allItems.map((d: DisputeRecord) => d.form_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [allItems])

  const csrNameOptions = useMemo(() => {
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
    selectedCsrNames.length > 0 ||
    selectedReviewerNames.length > 0 ||
    selectedStatuses.length > 0 ||
    dateRange.start !== defaultDateRange90().start ||
    dateRange.end   !== defaultDateRange90().end

  const resetFilters = () => {
    setDisputeId('')
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

        {/* Line break — date + search on second row */}
        <div className="basis-full" />

        {/* 5. Date range */}
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />

        {/* 6. Dispute # search */}
        <div className="relative w-[150px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Dispute #"
            value={disputeId}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '')
              setDisputeId(v)
              setPage(1)
            }}
            className="pl-8 h-9 text-[13px]"
          />
        </div>
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
                <SortableTableHead field="id"               sort={sort} dir={dir} onSort={toggle} className="w-[75px]">Dispute #</SortableTableHead>
                <SortableTableHead field="submission_id"    sort={sort} dir={dir} onSort={toggle} className="w-[75px]">Review #</SortableTableHead>
                <SortableTableHead field="status"           sort={sort} dir={dir} onSort={toggle} className="w-[70px]">Status</SortableTableHead>
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={toggle} className="w-[230px]">Form Name</SortableTableHead>
                {!isCSR && <SortableTableHead field="csr_name" sort={sort} dir={dir} onSort={toggle} className="w-[170px]">CSR</SortableTableHead>}
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
                    <TableCell className="text-[13px] text-slate-600">{STATUS_LABELS[d.status] ?? d.status}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.form_name ?? '—'}</TableCell>
                    {!isCSR && <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{d.csr_name ?? '—'}</TableCell>}
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
