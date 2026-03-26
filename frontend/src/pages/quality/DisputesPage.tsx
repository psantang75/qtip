import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { type DisputeRecord } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate as fmtDate, defaultDateRange90 } from '@/utils/dateFormat'

// Dispute-level statuses only
const DISPUTE_STATUSES = ['OPEN', 'UPHELD', 'ADJUSTED']

const DEFAULT_PAGE_SIZE = 20

interface DisputeListViewProps {
  isManager: boolean
}

function DisputeListView({ isManager }: DisputeListViewProps) {
  const navigate = useNavigate()

  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange90())

  // Multi-select filter state — staged via StagedMultiSelect, applied on click
  const [selectedFormNames,     setSelectedFormNames]     = useState<string[]>([])
  const [selectedCsrNames,      setSelectedCsrNames]      = useState<string[]>([])
  const [selectedReviewerNames, setSelectedReviewerNames] = useState<string[]>([])
  const [selectedStatuses,      setSelectedStatuses]      = useState<string[]>([])

  // For single status selection pass to API; multiple handled client-side
  const apiStatus = selectedStatuses.length === 1 ? selectedStatuses[0] : undefined

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-disputes', page, pageSize, apiStatus, dateRange],
    queryFn: () => qaService.getManagerDisputes({
      page, limit: pageSize,
      status:    apiStatus,
      startDate: dateRange.start || undefined,
      endDate:   dateRange.end   || undefined,
    }),
    placeholderData: (prev: any) => prev,
  })

  const totalPages = data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / pageSize) : 1)

  // Derive dropdown options from fetched items
  const formNameOptions = useMemo(() => {
    const s = new Set((data?.items ?? []).map((d: DisputeRecord) => d.form_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [data?.items])

  const csrNameOptions = useMemo(() => {
    const s = new Set((data?.items ?? []).map((d: DisputeRecord) => d.csr_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [data?.items])

  const reviewerNameOptions = useMemo(() => {
    const s = new Set((data?.items ?? []).map((d: any) => d.qa_analyst_name).filter(Boolean))
    return Array.from(s).sort() as string[]
  }, [data?.items])

  const statusOptions = useMemo(() => {
    const present = new Set((data?.items ?? []).map((d: DisputeRecord) => d.status).filter(Boolean))
    return DISPUTE_STATUSES.filter(s => present.has(s as any))
  }, [data?.items])

  // Client-side filter for multi-selections
  const clientFiltered = useMemo(() => {
    let items: DisputeRecord[] = data?.items ?? []
    if (selectedFormNames.length > 0)
      items = items.filter(d => selectedFormNames.includes(d.form_name ?? ''))
    if (selectedCsrNames.length > 0)
      items = items.filter(d => selectedCsrNames.includes(d.csr_name ?? ''))
    if (selectedReviewerNames.length > 0)
      items = items.filter(d => selectedReviewerNames.includes((d as any).qa_analyst_name ?? ''))
    if (selectedStatuses.length > 1)
      items = items.filter(d => selectedStatuses.includes(d.status))
    return items
  }, [data?.items, selectedFormNames, selectedCsrNames, selectedReviewerNames, selectedStatuses])

  const { sort, dir, toggle, sorted } = useListSort(clientFiltered)

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

  const fromLabel = isManager ? 'Dispute Resolution' : 'Disputes'
  const colSpan   = 10

  return (
    <QualityListPage>
      <QualityPageHeader title={fromLabel} />

      <QualityFilterBar
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: data?.total ?? 0 }}
      >
        {/* 1. Forms */}
        <StagedMultiSelect
          options={formNameOptions}
          selected={selectedFormNames}
          onApply={v => { setSelectedFormNames(v); setPage(1) }}
          placeholder="All Forms"
          width="w-[340px]"
        />

        {/* 2. CSR */}
        {csrNameOptions.length > 0 && (
          <StagedMultiSelect
            options={csrNameOptions}
            selected={selectedCsrNames}
            onApply={v => { setSelectedCsrNames(v); setPage(1) }}
            placeholder="All CSRs"
            width="w-[200px]"
          />
        )}

        {/* 3. Reviewer */}
        {reviewerNameOptions.length > 0 && (
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
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="status"         sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <SortableTableHead field="form_name"      sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                <SortableTableHead field="csr_name"       sort={sort} dir={dir} onSort={toggle}>CSR</SortableTableHead>
                <SortableTableHead field="qa_analyst_name" sort={sort} dir={dir} onSort={toggle}>Reviewer</SortableTableHead>
                <SortableTableHead field="submission_id"  sort={sort} dir={dir} onSort={toggle}>Review #</SortableTableHead>
                <SortableTableHead field="id"             sort={sort} dir={dir} onSort={toggle}>Dispute #</SortableTableHead>
                <SortableTableHead field="created_at"     sort={sort} dir={dir} onSort={toggle}>Date</SortableTableHead>
                <SortableTableHead field="original_score" sort={sort} dir={dir} onSort={toggle} right>Score</SortableTableHead>
                <SortableTableHead field="adjusted_score" sort={sort} dir={dir} onSort={toggle} right>Adjusted Score</SortableTableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length ? (
                sorted.map((d: DisputeRecord) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`, {
                      state: { from: fromLabel, fromPath: '/app/quality/disputes' },
                    })}>
                    <TableCell className="text-[13px] text-slate-600">
                      {d.status.charAt(0) + d.status.slice(1).toLowerCase()}
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{d.form_name ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.csr_name ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{(d as any).qa_analyst_name ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-500">#{d.submission_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-500">#{d.id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{fmtDate(d.created_at)}</TableCell>
                    <TableCell className="text-right pr-6 text-[13px] font-medium text-slate-700">
                      {d.original_score != null && d.original_score > 0
                        ? `${d.original_score.toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right pr-20 text-[13px] text-slate-600">
                      {(d as any).adjusted_score != null && (d as any).adjusted_score > 0
                        ? `${Number((d as any).adjusted_score).toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="pl-2">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/app/quality/submissions/${d.submission_id}`, {
                            state: { from: fromLabel, fromPath: '/app/quality/disputes' },
                          })
                        }}>
                        <Eye size={12} className="mr-1" />
                        {d.status === 'OPEN' ? 'Resolve' : 'View'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={colSpan}
                  icon={AlertTriangle}
                  title={hasFilters ? 'No disputes match your filters.' : 'No disputes found.'}
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
        totalItems={data?.total ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </QualityListPage>
  )
}

export default function DisputesPage() {
  const { user } = useAuth()
  const isManager = (user?.role_id ?? 0) === 5
  return <DisputeListView isManager={isManager} />
}
