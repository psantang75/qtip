import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, type Submission } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SubmissionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const roleId      = user?.role_id ?? 0
  const isAdminOrQA = roleId === 1 || roleId === 2
  const isManager   = roleId === 5
  const isCSR       = roleId === 3

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    q: '', status: 'all', form: 'all', from: '', to: '', page: '1', size: '20',
  })

  const search       = get('q')
  const statusFilter = get('status')
  const formId       = get('form')
  const dateFrom     = get('from')
  const dateTo       = get('to')
  const page         = parseInt(get('page')) || 1
  const pageSize     = parseInt(get('size')) || 20

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  // Form options — only loaded for admin/QA/manager
  const { data: formOptions = [] } = useQuery({
    queryKey: ['forms-filter'],
    queryFn: () => qaService.getFormsForFilter(),
    enabled: !!user && !isCSR,
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['submissions', roleId, page, pageSize, search, statusFilter, formId, dateFrom, dateTo],
    queryFn: () => {
      const status = statusFilter !== 'all' ? statusFilter : undefined
      const fid    = formId !== 'all' ? parseInt(formId) : undefined
      const ds     = dateFrom || undefined
      const de     = dateTo   || undefined

      if (isCSR)     return qaService.getCSRAudits({ page, limit: pageSize, search: search || undefined, status, start_date: ds, end_date: de })
      if (isManager) return qaService.getTeamAudits({ page, limit: pageSize, search: search || undefined, status, form_id: fid, start_date: ds, end_date: de })
      return qaService.getSubmissions({ page, limit: pageSize, search: search || undefined, status, form_id: fid, date_start: ds, date_end: de })
    },
    enabled: !!user,
    placeholderData: (prev: any) => prev,
  })

  const totalPages = data?.total != null ? Math.ceil(data.total / pageSize) : 1
  const hasFilters = hasAnyFilter

  // Sort within the current page — same shared hook used by every other list view
  const { sort, dir, toggle, sorted: sortedItems } = useListSort(data?.items ?? [])

  const resetFilters = () => reset()

  return (
    <QualityListPage>
      <QualityPageHeader
        title={isCSR ? 'My Reviews' : isManager ? 'Team Reviews' : 'Submissions'}

        count={data?.total}
        onRefresh={refetch}
      />

      <QualityFilterBar
        search={search}
        onSearchChange={v => setMany({ q: v, page: '1' })}
        searchPlaceholder={isCSR ? 'Search by form…' : 'Search by CSR name, form…'}
        selects={[
          {
            id: 'status',
            value: statusFilter,
            onChange: v => setMany({ status: v, page: '1' }),
            options: [
              { value: 'all',       label: 'All statuses' },
              { value: 'SUBMITTED', label: 'Submitted' },
              { value: 'DISPUTED',  label: 'Disputed' },
              { value: 'FINALIZED', label: 'Finalized' },
            ],
          },
          ...(!isCSR && formOptions.length > 0 ? [{
            id: 'form',
            value: formId,
            onChange: (v: string) => setMany({ form: v, page: '1' }),
            placeholder: 'All forms',
            width: 'w-[180px]',
            options: [
              { value: 'all', label: 'All forms' },
              ...(formOptions as any[]).map((f: any) => ({ value: String(f.id), label: f.form_name })),
            ],
          }] : []),
        ]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: data?.total ?? 0 }}
      >
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={v => setMany({ from: v.start, to: v.end, page: '1' })}
        />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <TableErrorState message="Failed to load submissions." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="status"        sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <SortableTableHead field="form_id"       sort={sort} dir={dir} onSort={toggle}>Form ID</SortableTableHead>
                <SortableTableHead field="form_name"     sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                {isAdminOrQA && <SortableTableHead field="reviewer_name" sort={sort} dir={dir} onSort={toggle}>Reviewer</SortableTableHead>}
                {!isCSR && <SortableTableHead field="csr_name" sort={sort} dir={dir} onSort={toggle}>CSR</SortableTableHead>}
                <SortableTableHead field="created_at"   sort={sort} dir={dir} onSort={toggle}>Date</SortableTableHead>
                <SortableTableHead field="score"        sort={sort} dir={dir} onSort={toggle} right>Score</SortableTableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.length ? (
                sortedItems.map((row: Submission) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/quality/submissions/${row.id}`, { state: { from: isCSR ? 'My Reviews' : isManager ? 'Team Reviews' : 'Submissions', fromPath: '/app/quality/submissions' } })}>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">{row.form_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{row.form_name}</TableCell>
                    {isAdminOrQA && <TableCell className="text-[13px] text-slate-600">{row.reviewer_name ?? '—'}</TableCell>}
                    {!isCSR && <TableCell className="text-[13px] text-slate-600">{row.csr_name}</TableCell>}
                    <TableCell className="text-[13px] text-slate-600">{fmtDate(row.created_at)}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {row.score != null && row.score > 0
                        ? <span className={scoreColor(row.score)}>{row.score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={e => { e.stopPropagation(); navigate(`/app/quality/submissions/${row.id}`, { state: { from: isCSR ? 'My Reviews' : isManager ? 'Team Reviews' : 'Submissions', fromPath: '/app/quality/submissions' } }) }}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={isAdminOrQA ? 8 : isCSR ? 6 : 7}
                  icon={FileText}
                  title="No submissions found."
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
        onPageSizeChange={setPageSize}
      />
    </QualityListPage>
  )
}
