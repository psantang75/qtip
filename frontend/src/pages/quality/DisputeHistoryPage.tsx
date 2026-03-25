import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { History, Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, type DisputeHistoryItem } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useListSort } from '@/hooks/useListSort'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function DisputeHistoryPage() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(20)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['csr-dispute-history', page, pageSize, statusFilter],
    queryFn: () => qaService.getCSRDisputeHistory({
      page,
      limit:  pageSize,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }),
    enabled: !!user,
    placeholderData: (prev: any) => prev,
  })

  const hasFilters  = search !== '' || statusFilter !== 'all' || !!dateRange.start || !!dateRange.end
  const totalPages  = data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / pageSize) : 1)

  // Client-side search + date filter (endpoint doesn't expose these params)
  const filtered: DisputeHistoryItem[] = (data?.items ?? []).filter((d: DisputeHistoryItem) => {
    if (search) {
      const q = search.toLowerCase()
      const matchSearch =
        String(d.dispute_id).includes(q) ||
        String(d.audit_id).includes(q)   ||
        d.form_name?.toLowerCase().includes(q)
      if (!matchSearch) return false
    }
    if (dateRange.start) {
      const created = d.created_at ? d.created_at.split('T')[0] : ''
      if (created && created < dateRange.start) return false
    }
    if (dateRange.end) {
      const created = d.created_at ? d.created_at.split('T')[0] : ''
      if (created && created > dateRange.end) return false
    }
    return true
  })

  const { sort, dir, toggle, sorted } = useListSort(filtered)

  const resetFilters = () => {
    setSearch(''); setStatus('all'); setDateRange({ start: '', end: '' }); setPage(1); setPageSize(20)
  }

  return (
    <div className="p-6 space-y-5">
      <QualityPageHeader
        title="Dispute History"
        subtitle="All disputes you have submitted"
        count={data?.total}
        onRefresh={refetch}
      />

      <QualityFilterBar
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by dispute ID, review ID, or form…"
        selects={[{
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
        }]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ filtered: sorted.length, total: data?.total ?? 0 }}
      >
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <TableErrorState message="Failed to load dispute history." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="status"      sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <SortableTableHead field="dispute_id"  sort={sort} dir={dir} onSort={toggle}>Dispute ID</SortableTableHead>
                <SortableTableHead field="audit_id"    sort={sort} dir={dir} onSort={toggle}>Review ID</SortableTableHead>
                <SortableTableHead field="form_name"   sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                <SortableTableHead field="score"       sort={sort} dir={dir} onSort={toggle} right>Score</SortableTableHead>
                <SortableTableHead field="previous_score" sort={sort} dir={dir} onSort={toggle} right>Prev Score</SortableTableHead>
                <SortableTableHead field="created_at"  sort={sort} dir={dir} onSort={toggle}>Date</SortableTableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length ? (
                sorted.map((d: DisputeHistoryItem) => (
                  <TableRow key={d.dispute_id} className="hover:bg-slate-50/50">
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">#{d.dispute_id}</TableCell>
                    <TableCell>
                      <button
                        className="text-[13px] font-medium text-primary hover:underline"
                        onClick={() => navigate(`/app/quality/submissions/${d.audit_id}`)}
                      >
                        #{d.audit_id}
                      </button>
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{d.form_name}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {d.score != null && d.score > 0
                        ? <span className={scoreColor(d.score)}>{d.score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right text-[13px]">
                      {d.previous_score != null
                        ? <span className="text-slate-500">{d.previous_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{fmtDate(d.created_at)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={() => navigate(`/app/quality/submissions/${d.audit_id}`)}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={8}
                  icon={History}
                  title={hasFilters ? 'No disputes match your filters.' : 'You have no dispute history yet.'}
                  description={hasFilters ? undefined : 'Disputes you submit will appear here.'}
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
