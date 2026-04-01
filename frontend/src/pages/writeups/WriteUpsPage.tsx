import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, FileWarning, Eye } from 'lucide-react'
import writeupService, { type WriteUp, type WriteUpType, type WriteUpStatus } from '@/services/writeupService'
import userService from '@/services/userService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { ListPagination } from '@/components/common/ListPagination'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate } from '@/utils/dateFormat'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

export const WRITE_UP_TYPE_LABELS: Record<WriteUpType, string> = {
  VERBAL_WARNING:  'Verbal Warning',
  WRITTEN_WARNING: 'Written Warning',
  FINAL_WARNING:   'Final Warning',
}

const WRITE_UP_TYPE_STYLES: Record<WriteUpType, string> = {
  VERBAL_WARNING:  'bg-amber-50  text-amber-700',
  WRITTEN_WARNING: 'bg-orange-50 text-orange-700',
  FINAL_WARNING:   'bg-red-50    text-red-700',
}

export const WRITE_UP_STATUS_LABELS: Record<WriteUpStatus, string> = {
  DRAFT:               'Draft',
  SCHEDULED:           'Scheduled',
  DELIVERED:           'Delivered',
  AWAITING_SIGNATURE:  'Awaiting Signature',
  SIGNED:              'Signed',
  FOLLOW_UP_PENDING:   'Follow-Up Pending',
  CLOSED:              'Closed',
}

const ALL_STATUSES = Object.keys(WRITE_UP_STATUS_LABELS) as WriteUpStatus[]
const ALL_TYPES    = Object.keys(WRITE_UP_TYPE_LABELS)   as WriteUpType[]

// ── Badge components ──────────────────────────────────────────────────────────

export function WriteUpTypeBadge({ type }: { type: WriteUpType }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
      WRITE_UP_TYPE_STYLES[type] ?? 'bg-slate-100 text-slate-600',
    )}>
      {WRITE_UP_TYPE_LABELS[type] ?? type}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WriteUpsPage() {
  const navigate    = useNavigate()
  const { user }    = useAuth()
  const canCreate   = [1, 2, 5].includes(user?.role_id ?? 0)

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    search: '', csrs: '', statuses: '', types: '',
    from: '', to: '', page: '1', size: '20',
  })

  const search      = get('search')
  const csrsParam   = get('csrs')
  const statusParam = get('statuses')
  const typeParam   = get('types')
  const dateFrom    = get('from')
  const dateTo      = get('to')
  const page        = parseInt(get('page')) || 1
  const pageSize    = parseInt(get('size')) || 20

  const setPage     = (p: number)  => set('page', String(p))
  const setPageSize = (s: number)  => setMany({ size: String(s), page: '1' })

  const selectedCsrs     = useMemo(() => csrsParam   ? csrsParam.split(',').filter(Boolean)   : [], [csrsParam])
  const selectedStatuses = useMemo(() => statusParam ? statusParam.split(',').filter(Boolean) : [], [statusParam])
  const selectedTypes    = useMemo(() => typeParam   ? typeParam.split(',').filter(Boolean)   : [], [typeParam])

  // Fetch write-ups with server-side date + search filtering
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['writeups', page, pageSize, dateFrom, dateTo, search],
    queryFn: () => writeupService.getWriteUps({
      page,
      limit:     pageSize,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
      search:    search   || undefined,
    }),
    placeholderData: (prev) => prev,
  })

  // Fetch all CSRs for the filter dropdown
  const { data: csrData } = useQuery({
    queryKey: ['users', 'csrs'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 3, is_active: true }),
    staleTime: Infinity,
  })
  const csrOptions = useMemo(
    () => (csrData?.items ?? []).map(u => u.username).sort(),
    [csrData?.items],
  )

  // Client-side filtering for CSR, status, type
  const clientFiltered = useMemo(() => {
    let items = data?.items ?? []
    if (selectedCsrs.length)     items = items.filter(w => selectedCsrs.includes(w.csr_name))
    if (selectedStatuses.length) items = items.filter(w => selectedStatuses.includes(WRITE_UP_STATUS_LABELS[w.status]))
    if (selectedTypes.length)    items = items.filter(w => selectedTypes.includes(WRITE_UP_TYPE_LABELS[w.document_type]))
    return items
  }, [data?.items, selectedCsrs, selectedStatuses, selectedTypes])

  const { sort, dir, toggle, sorted } = useListSort(clientFiltered)

  const hasClientFilter  = selectedCsrs.length > 0 || selectedStatuses.length > 0 || selectedTypes.length > 0
  const displayTotal     = hasClientFilter ? clientFiltered.length : (data?.total ?? 0)

  const statusOptions = ALL_STATUSES.map(s => WRITE_UP_STATUS_LABELS[s])
  const typeOptions   = ALL_TYPES.map(t => WRITE_UP_TYPE_LABELS[t])

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Write-Ups"
        subtitle="Manage employee disciplinary documentation"
        actions={
          canCreate ? (
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => navigate('/app/writeups/new')}
            >
              <Plus className="h-4 w-4 mr-1" /> New Write-Up
            </Button>
          ) : undefined
        }
      />

      <QualityFilterBar
        hasFilters={hasAnyFilter || hasClientFilter}
        onReset={reset}
        resultCount={{ total: displayTotal }}
      >
        {/* Search */}
        <Input
          placeholder="Search by name…"
          value={search}
          onChange={e => setMany({ search: e.target.value, page: '1' })}
          className="h-9 w-[200px]"
        />

        {/* Date range */}
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={r => setMany({ from: r.start, to: r.end, page: '1' })}
        />

        {/* CSR */}
        <StagedMultiSelect
          options={csrOptions}
          selected={selectedCsrs}
          onApply={v => setMany({ csrs: v.join(','), page: '1' })}
          placeholder="All Employees"
          width="w-[260px]"
        />

        {/* Status */}
        <StagedMultiSelect
          options={statusOptions}
          selected={selectedStatuses}
          onApply={v => setMany({ statuses: v.join(','), page: '1' })}
          placeholder="All Statuses"
          width="w-[200px]"
        />

        {/* Document type */}
        <StagedMultiSelect
          options={typeOptions}
          selected={selectedTypes}
          onApply={v => setMany({ types: v.join(','), page: '1' })}
          placeholder="All Types"
          width="w-[200px]"
        />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={8} />
        ) : isError ? (
          <TableErrorState message="Failed to load write-ups." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <TableHead className="w-[50px] text-slate-400">#</TableHead>
                <SortableTableHead field="document_type" sort={sort} dir={dir} onSort={toggle} className="min-w-[150px]">Type</SortableTableHead>
                <SortableTableHead field="csr_name"      sort={sort} dir={dir} onSort={toggle} className="min-w-[180px]">Employee</SortableTableHead>
                <SortableTableHead field="status"        sort={sort} dir={dir} onSort={toggle} className="min-w-[160px]">Status</SortableTableHead>
                <SortableTableHead field="meeting_date"  sort={sort} dir={dir} onSort={toggle} className="min-w-[120px]">Meeting Date</SortableTableHead>
                <SortableTableHead field="created_by_name" sort={sort} dir={dir} onSort={toggle} className="min-w-[150px]">Created By</SortableTableHead>
                <SortableTableHead field="created_at"   sort={sort} dir={dir} onSort={toggle} className="min-w-[110px]">Created</SortableTableHead>
                <TableHead className="w-20" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableEmptyState
                  colSpan={8}
                  icon={FileWarning}
                  title="No write-ups found"
                  description={canCreate ? 'Create a new write-up to get started' : 'No write-ups have been issued yet'}
                  action={canCreate ? { label: 'New Write-Up', onClick: () => navigate('/app/writeups/new') } : undefined}
                />
              ) : sorted.map((w: WriteUp) => (
                <TableRow
                  key={w.id}
                  className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/writeups/${w.id}`)}
                >
                  <TableCell className="text-[11px] text-slate-400 font-mono">#{w.id}</TableCell>
                  <TableCell><WriteUpTypeBadge type={w.document_type} /></TableCell>
                  <TableCell className="text-[13px] font-medium text-slate-900">{w.csr_name}</TableCell>
                  <TableCell><StatusBadge status={w.status} /></TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {w.meeting_date ? formatQualityDate(w.meeting_date) : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">{w.created_by_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {formatQualityDate(w.created_at)}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                      onClick={() => navigate(`/app/writeups/${w.id}`)}
                    >
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
        totalPages={data?.totalPages ?? 1}
        totalItems={displayTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </QualityListPage>
  )
}
