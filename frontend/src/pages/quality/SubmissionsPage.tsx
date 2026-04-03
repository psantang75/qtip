import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, Eye } from 'lucide-react'
import qaService, { type Submission } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { useQualityRole } from '@/hooks/useQualityRole'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { formatQualityDate as fmtDate, defaultDateRange90 } from '@/utils/dateFormat'

// Submission-level statuses (dispute resolution statuses are separate)
const SUBMISSION_STATUSES = ['SUBMITTED', 'DISPUTED', 'FINALIZED']

export default function SubmissionsPage() {
  const navigate = useNavigate()
  const { roleId, isAdminOrQA, isManager, isCSR } = useQualityRole()

  const pageTitle = isCSR ? 'My Reviews' : isManager ? 'Completed Reviews' : 'Completed Forms'

  const { start: defaultFrom, end: defaultTo } = useMemo(() => defaultDateRange90(), [])

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    forms: '', csrs: '', statuses: '', from: defaultFrom, to: defaultTo, page: '1', size: '20',
  })

  const formsParam    = get('forms')
  const csrsParam     = get('csrs')
  const statusesParam = get('statuses')
  const dateFrom      = get('from')
  const dateTo        = get('to')
  const page          = parseInt(get('page')) || 1
  const pageSize      = parseInt(get('size')) || 20

  // Parsed multi-select values
  const selectedFormNames = useMemo(
    () => formsParam ? formsParam.split(',').filter(Boolean) : [],
    [formsParam],
  )
  const selectedCsrNames = useMemo(
    () => csrsParam ? csrsParam.split(',').filter(Boolean) : [],
    [csrsParam],
  )
  const selectedStatuses = useMemo(
    () => statusesParam ? statusesParam.split(',').filter(Boolean) : [],
    [statusesParam],
  )

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  // For single selections, pass value to API; multiple = client-side filtered
  const apiStatus = selectedStatuses.length === 1 ? selectedStatuses[0] : undefined

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['submissions', roleId, page, pageSize, statusesParam, formsParam, csrsParam, dateFrom, dateTo],
    queryFn: () => {
      const ds = dateFrom || undefined
      const de = dateTo   || undefined

      if (isCSR)     return qaService.getCSRAudits({ page, limit: pageSize, status: apiStatus, start_date: ds, end_date: de })
      if (isManager) return qaService.getTeamAudits({ page, limit: pageSize, status: apiStatus, start_date: ds, end_date: de })
      return qaService.getSubmissions({ page, limit: pageSize, status: apiStatus, date_start: ds, date_end: de })
    },
    enabled: roleId > 0,
    placeholderData: (prev) => prev,
  })

  // Derive filter options from the fetched items — only show what's in the current result
  const formNameOptions = useMemo(() => {
    const names = new Set((data?.items ?? []).map((r: Submission) => r.form_name).filter(Boolean))
    return Array.from(names).sort() as string[]
  }, [data?.items])

  const csrNameOptions = useMemo(() => {
    const names = new Set((data?.items ?? []).map((r: Submission) => r.csr_name).filter(Boolean))
    return Array.from(names).sort() as string[]
  }, [data?.items])

  const statusOptions = useMemo(() => {
    const present = new Set((data?.items ?? []).map((r: Submission) => r.status).filter(Boolean))
    return SUBMISSION_STATUSES.filter(s => present.has(s))
  }, [data?.items])

  // Client-side filtering for multi-selection (single selections handled by API)
  const clientFiltered = useMemo(() => {
    let items: Submission[] = data?.items ?? []
    if (selectedFormNames.length > 0) {
      items = items.filter(r => selectedFormNames.includes(r.form_name ?? ''))
    }
    if (selectedCsrNames.length > 0) {
      items = items.filter(r => selectedCsrNames.includes(r.csr_name ?? ''))
    }
    if (selectedStatuses.length > 1) {
      items = items.filter(r => selectedStatuses.includes(r.status))
    }
    return items
  }, [data?.items, selectedFormNames, selectedCsrNames, selectedStatuses])

  const totalPages = data?.total != null ? Math.ceil(data.total / pageSize) : 1
  const hasFilters = hasAnyFilter

  const { sort, dir, toggle, sorted: sortedItems } = useListSort(clientFiltered)

  const colSpan = isAdminOrQA ? 8 : isManager ? 7 : 6

  return (
    <QualityListPage>
      <QualityPageHeader title={pageTitle} />

      <QualityFilterBar
        hasFilters={hasFilters}
        onReset={reset}
        resultCount={{ total: data?.total ?? 0 }}
      >
        {/* 1. Forms */}
        <StagedMultiSelect
          options={formNameOptions}
          selected={selectedFormNames}
          onApply={names => setMany({ forms: names.join(','), page: '1' })}
          placeholder="All Forms"
          width="w-[340px]"
        />

        {/* 2. CSR Name */}
        {!isCSR && csrNameOptions.length > 0 && (
          <StagedMultiSelect
            options={csrNameOptions}
            selected={selectedCsrNames}
            onApply={names => setMany({ csrs: names.join(','), page: '1' })}
            placeholder="All CSRs"
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

        {/* 4. Date range */}
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={v => setMany({ from: v.start, to: v.end, page: '1' })}
        />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load submissions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="status"        sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <SortableTableHead field="form_name"     sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                {!isCSR      && <SortableTableHead field="csr_name"      sort={sort} dir={dir} onSort={toggle}>CSR</SortableTableHead>}
                <SortableTableHead field="id"           sort={sort} dir={dir} onSort={toggle}>Review #</SortableTableHead>
                <SortableTableHead field="created_at"   sort={sort} dir={dir} onSort={toggle}>Review Date</SortableTableHead>
                <SortableTableHead field="interaction_date" sort={sort} dir={dir} onSort={toggle}>Interaction Date</SortableTableHead>
                <SortableTableHead field="score"        sort={sort} dir={dir} onSort={toggle}>Score</SortableTableHead>
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
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{row.form_name}</TableCell>
                    {!isCSR      && <TableCell className="text-[13px] text-slate-600">{row.csr_name ?? '—'}</TableCell>}
                    <TableCell className="text-[13px] text-slate-500">{row.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{fmtDate(row.created_at)}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{row.interaction_date ? fmtDate(row.interaction_date) : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-700">
                      {row.score != null && row.score > 0
                        ? `${row.score.toFixed(1)}%`
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="pl-2">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={e => {
                          e.stopPropagation()
                          navigate(`/app/quality/submissions/${row.id}`, {
                            state: { from: pageTitle, fromPath: '/app/quality/submissions' },
                          })
                        }}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
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
      </div>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={data?.total ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </QualityListPage>
  )
}
