import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useListSort } from '@/hooks/useListSort'

const DEFAULT_PAGE_SIZE = 20

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })


// ── Manager Dispute Resolution ────────────────────────────────────────────────
function ManagerDisputeResolution() {
  const navigate = useNavigate()
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(DEFAULT_PAGE_SIZE)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [csrId, setCsrId]         = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' })

  const { data: teamCSRs = [] } = useQuery({
    queryKey: ['team-csrs'],
    queryFn: () => qaService.getTeamCSRs(),
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-disputes', page, pageSize, statusFilter, csrId, dateRange],
    queryFn: () => qaService.getManagerDisputes({
      page, limit: pageSize,
      status:    statusFilter !== 'all' ? statusFilter : undefined,
      csr_id:    csrId !== 'all' ? parseInt(csrId) : undefined,
      startDate: dateRange.start || undefined,
      endDate:   dateRange.end   || undefined,
    }),
    placeholderData: (prev: any) => prev,
  })

  const hasFilters = search !== '' || statusFilter !== 'all' || csrId !== 'all' || !!dateRange.start || !!dateRange.end
  const totalPages = data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / pageSize) : 1)

  const filtered = (data?.items ?? []).filter((d: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(d.id ?? '').includes(q)           ||
      String(d.submission_id ?? '').includes(q) ||
      d.csr_name?.toLowerCase().includes(q)    ||
      d.form_name?.toLowerCase().includes(q)
    )
  })
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const mgrSort = useListSort(filtered)

  const resetFilters = () => { setSearch(''); setStatus('all'); setCsrId('all'); setDateRange({ start: '', end: '' }); setPage(1); setPageSize(DEFAULT_PAGE_SIZE) }

  return (
    <div className="p-6 space-y-5">
      <QualityPageHeader
        title="Dispute Resolution"
        subtitle="Your team's open and resolved disputes"
        count={data?.total}
        onRefresh={refetch}
      />

      <QualityFilterBar
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by CSR, form, dispute ID…"
        selects={[
          {
            id: 'status',
            value: statusFilter,
            onChange: v => { setStatus(v); setPage(1) },
            width: 'w-[160px]',
            options: [
              { value: 'all',      label: 'All statuses' },
              { value: 'OPEN',     label: 'Open' },
              { value: 'UPHELD',   label: 'Upheld' },
              { value: 'ADJUSTED', label: 'Adjusted' },
            ],
          },
          ...((teamCSRs as any[]).length > 0 ? [{
            id: 'csr',
            value: csrId,
            onChange: (v: string) => { setCsrId(v); setPage(1) },
            placeholder: 'All CSRs',
            width: 'w-[160px]',
            options: [
              { value: 'all', label: 'All CSRs' },
              ...(teamCSRs as any[]).map((c: any) => ({ value: String(c.id), label: c.name })),
            ],
          }] : []),
        ]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: data?.total ?? 0 }}
      >
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
      </QualityFilterBar>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <TableErrorState message="Failed to load disputes." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="status"         sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Status</SortableTableHead>
                <SortableTableHead field="id"             sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Dispute ID</SortableTableHead>
                <SortableTableHead field="csr_name"       sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>CSR</SortableTableHead>
                <SortableTableHead field="submission_id"  sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Review ID</SortableTableHead>
                <SortableTableHead field="form_name"      sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Form Name</SortableTableHead>
                <SortableTableHead field="original_score" sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle} right>Score</SortableTableHead>
                <SortableTableHead field="previous_score" sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle} right>Prev Score</SortableTableHead>
                <SortableTableHead field="created_at"     sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Date</SortableTableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mgrSort.sorted.length ? (
                mgrSort.sorted.map((d: any) => (
                  <TableRow key={d.id ?? d.dispute_id} className="cursor-pointer hover:bg-slate-50/50">
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">
                      #{d.id ?? d.dispute_id ?? '—'}
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">
                      {d.csr_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <button
                        className="text-[13px] font-medium text-primary hover:underline"
                        onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}
                      >
                        #{d.submission_id ?? '—'}
                      </button>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.form_name ?? '—'}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {d.original_score != null && d.original_score > 0
                        ? <span className={scoreColor(d.original_score)}>{d.original_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right text-[13px]">
                      {d.previous_score != null
                        ? <span className="text-slate-500">{d.previous_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {d.created_at ? fmtDate(d.created_at) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                          onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}>
                          <Eye size={12} className="mr-1" />
                          {d.status === 'OPEN' ? 'Resolve' : 'View'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={9}
                  icon={AlertTriangle}
                  title={hasFilters ? 'No disputes match your filters.' : 'No disputes found for your team.'}
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
    </div>
  )
}

// ── Admin / QA Disputes ───────────────────────────────────────────────────────
function AdminQADisputes() {
  const navigate  = useNavigate()
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(DEFAULT_PAGE_SIZE)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [csrId, setCsrId]         = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' })

  const { data: filterOptions } = useQuery({
    queryKey: ['analytics-filters'],
    queryFn: () => qaService.getAnalyticsFilters(),
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-disputes', page, pageSize, statusFilter, csrId, dateRange],
    queryFn: () => qaService.getManagerDisputes({
      page, limit: pageSize,
      status:    statusFilter !== 'all' ? statusFilter : undefined,
      csr_id:    csrId !== 'all' ? parseInt(csrId) : undefined,
      startDate: dateRange.start || undefined,
      endDate:   dateRange.end   || undefined,
    }),
    placeholderData: (prev: any) => prev,
  })

  const hasFilters = search !== '' || statusFilter !== 'all' || csrId !== 'all' || !!dateRange.start || !!dateRange.end
  const totalPages = data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / pageSize) : 1)

  const filteredAdm = (data?.items ?? []).filter((d: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(d.id ?? '').includes(q)           ||
      String(d.submission_id ?? '').includes(q) ||
      d.csr_name?.toLowerCase().includes(q)    ||
      d.form_name?.toLowerCase().includes(q)
    )
  })
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const admSort = useListSort(filteredAdm)

  const csrOptions: any[] = filterOptions?.csrs ?? []
  const resetFilters = () => { setSearch(''); setStatus('all'); setCsrId('all'); setDateRange({ start: '', end: '' }); setPage(1); setPageSize(DEFAULT_PAGE_SIZE) }

  return (
    <div className="p-6 space-y-5">
      <QualityPageHeader
        title="Disputes"
        subtitle="Organization-wide dispute management"
        count={data?.total}
        onRefresh={refetch}
      />

      <QualityFilterBar
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by CSR, form, ID…"
        selects={[
          {
            id: 'status',
            value: statusFilter,
            onChange: v => { setStatus(v); setPage(1) },
            width: 'w-[160px]',
            options: [
              { value: 'all',      label: 'All statuses' },
              { value: 'OPEN',     label: 'Open' },
              { value: 'UPHELD',   label: 'Upheld' },
              { value: 'ADJUSTED', label: 'Adjusted' },
            ],
          },
          ...(csrOptions.length > 0 ? [{
            id: 'csr',
            value: csrId,
            onChange: (v: string) => { setCsrId(v); setPage(1) },
            placeholder: 'All CSRs',
            width: 'w-[160px]',
            options: [
              { value: 'all', label: 'All CSRs' },
              ...csrOptions.map((c: any) => ({ value: String(c.id), label: c.name })),
            ],
          }] : []),
        ]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: data?.total ?? 0 }}
      >
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <TableErrorState message="Failed to load disputes." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="status"         sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Status</SortableTableHead>
                <SortableTableHead field="id"             sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Dispute ID</SortableTableHead>
                <SortableTableHead field="csr_name"       sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>CSR</SortableTableHead>
                <SortableTableHead field="submission_id"  sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Review ID</SortableTableHead>
                <SortableTableHead field="form_name"      sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Form Name</SortableTableHead>
                <SortableTableHead field="original_score" sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle} right>Score</SortableTableHead>
                <SortableTableHead field="created_at"     sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Date</SortableTableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admSort.sorted.length ? (
                admSort.sorted.map((d: any) => (
                  <TableRow key={d.id ?? d.dispute_id} className="cursor-pointer hover:bg-slate-50/50">
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">#{d.id ?? d.dispute_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{d.csr_name ?? '—'}</TableCell>
                    <TableCell>
                      <button className="text-[13px] font-medium text-primary hover:underline"
                        onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}>
                        #{d.submission_id ?? '—'}
                      </button>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.form_name ?? '—'}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {d.original_score != null && d.original_score > 0
                        ? <span className={scoreColor(d.original_score)}>{d.original_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {d.created_at ? fmtDate(d.created_at) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={8}
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
    </div>
  )
}

// ── Page entry ────────────────────────────────────────────────────────────────
export default function DisputesPage() {
  const { user } = useAuth()
  const roleId = user?.role_id ?? 0
  if (roleId === 5) return <ManagerDisputeResolution />
  return <AdminQADisputes />
}
