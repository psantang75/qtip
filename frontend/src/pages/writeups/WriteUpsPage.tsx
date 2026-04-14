import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, FileWarning, Eye } from 'lucide-react'
import writeupService, { type WriteUp, type WriteUpType, type WriteUpStatus } from '@/services/writeupService'

import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { GroupedStagedMultiSelect, type GroupedOption } from '@/components/common/GroupedStagedMultiSelect'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { ListPagination } from '@/components/common/ListPagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { useWriteUpRole } from '@/hooks/useWriteUpRole'
import { formatQualityDate } from '@/utils/dateFormat'
import {
  WRITE_UP_TYPE_LABELS,
  WRITE_UP_STATUS_LABELS,
  STATUS_LABELS,
  CLIENT_FETCH_LIMIT,
} from '@/constants/labels'

const ALL_STATUSES = Object.keys(WRITE_UP_STATUS_LABELS) as WriteUpStatus[]
const ALL_TYPES    = Object.keys(WRITE_UP_TYPE_LABELS)   as WriteUpType[]
const CLOSED_LABEL = WRITE_UP_STATUS_LABELS['CLOSED']

export function WriteUpTypeBadge({ type }: { type: WriteUpType }) {
  return <span className="text-[13px] text-slate-600">{WRITE_UP_TYPE_LABELS[type] ?? type}</span>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WriteUpsPage() {
  const navigate    = useNavigate()
  const { canManage: canCreate } = useWriteUpRole()

  const { get, set, setMany, reset, hasAnyFilter } = useUrlFilters({
    csrs: '', statuses: '', types: '', search: '',
    from: '', to: '', page: '1', size: '20',
  })

  const csrsParam   = get('csrs')
  const statusParam = get('statuses')
  const typeParam   = get('types')
  const searchParam = get('search')
  const dateFrom    = get('from')
  const dateTo      = get('to')
  const page        = parseInt(get('page')) || 1
  const pageSize    = parseInt(get('size')) || 20

  const setPage     = (p: number) => set('page', String(p))
  const setPageSize = (s: number) => setMany({ size: String(s), page: '1' })

  const selectedCsrs     = useMemo(() => csrsParam   ? csrsParam.split(',').filter(Boolean)   : [], [csrsParam])
  const selectedStatuses = useMemo(() => statusParam ? statusParam.split(',').filter(Boolean) : [], [statusParam])
  const selectedTypes    = useMemo(() => typeParam   ? typeParam.split(',').filter(Boolean)   : [], [typeParam])

  // Fetch ALL write-ups for the date range in one call
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['writeups', dateFrom, dateTo, searchParam],
    queryFn: () => writeupService.getWriteUps({
      page:      1,
      limit:     5000,
      date_from: dateFrom    || undefined,
      date_to:   dateTo      || undefined,
      search:    searchParam || undefined,
    }),
    placeholderData: (prev) => prev,
  })

  const allItems = data?.items ?? []

  // Dropdown options from the FULL result set
  const csrOptions = useMemo<GroupedOption[]>(() => {
    const names = Array.from(new Set(allItems.map(w => w.csr_name).filter(Boolean))).sort()
    return names.map(name => ({ group: '', value: name }))
  }, [allItems])

  const statusOptions = useMemo(() => ALL_STATUSES.map(s => WRITE_UP_STATUS_LABELS[s]), [])
  const typeOptions   = useMemo(() => ALL_TYPES.map(t => WRITE_UP_TYPE_LABELS[t]), [])

  const allExceptClosed = useMemo(() => statusOptions.filter(s => s !== CLOSED_LABEL), [statusOptions])
  const effectiveSelectedStatuses = useMemo(
    () => selectedStatuses.length === 0 ? allExceptClosed : selectedStatuses,
    [selectedStatuses, allExceptClosed],
  )

  // Client-side filtering on the full result set
  const filtered = useMemo(() => {
    let items = allItems
    if (selectedCsrs.length)               items = items.filter(w => selectedCsrs.includes(w.csr_name))
    if (effectiveSelectedStatuses.length)  items = items.filter(w => effectiveSelectedStatuses.includes(WRITE_UP_STATUS_LABELS[w.status]))
    if (selectedTypes.length)              items = items.filter(w => selectedTypes.includes(WRITE_UP_TYPE_LABELS[w.document_type]))
    return items
  }, [allItems, selectedCsrs, effectiveSelectedStatuses, selectedTypes])

  const { sort, dir, toggle, sorted } = useListSort(filtered)

  // Client-side pagination
  const paginatedItems = sorted.slice((page - 1) * pageSize, page * pageSize)
  const displayTotal   = filtered.length

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Write-Ups"
        actions={
          canCreate ? (
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => navigate('/app/performancewarnings/new')}
            >
              <Plus className="h-4 w-4 mr-1" /> New Write-Up
            </Button>
          ) : undefined
        }
      />

      <QualityFilterBar
        search={searchParam}
        onSearchChange={v => setMany({ search: v, page: '1' })}
        searchPlaceholder="Search by employee or creator…"
        hasFilters={hasAnyFilter}
        onReset={reset}
        resultCount={{ total: displayTotal }}
        truncated={allItems.length >= CLIENT_FETCH_LIMIT}
      >
        {/* ── Row 1: Employee · Type · Status ── */}
        <GroupedStagedMultiSelect
          options={csrOptions}
          selected={selectedCsrs}
          onApply={v => setMany({ csrs: v.join(','), page: '1' })}
          placeholder="All Employees"
          width="w-[390px]"
        />
        <StagedMultiSelect
          options={typeOptions}
          selected={selectedTypes}
          onApply={v => setMany({ types: v.join(','), page: '1' })}
          placeholder="All Types"
          width="w-[200px]"
        />
        <StagedMultiSelect
          options={statusOptions}
          selected={effectiveSelectedStatuses}
          onApply={v => {
            const isDefault = v.length === allExceptClosed.length && allExceptClosed.every(s => v.includes(s))
            setMany({ statuses: isDefault ? '' : v.join(','), page: '1' })
          }}
          placeholder="All Statuses"
          width="w-[200px]"
        />

        {/* ── Row break ── */}
        <div className="w-full" />

        {/* ── Row 2: Meeting Date Range ── */}
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-slate-500 shrink-0">Meeting</span>
          <Input type="date" value={dateFrom} max={dateTo || undefined}
            onChange={e => setMany({ from: e.target.value, page: '1' })}
            className="h-9 w-[140px]" />
          <span className="text-[12px] text-slate-400">–</span>
          <Input type="date" value={dateTo} min={dateFrom || undefined}
            onChange={e => setMany({ to: e.target.value, page: '1' })}
            className="h-9 w-[140px]" />
        </div>
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
              {paginatedItems.length === 0 ? (
                <TableEmptyState
                  colSpan={8}
                  icon={FileWarning}
                  title="No write-ups found"
                  description={canCreate ? 'Create a new write-up to get started' : 'No write-ups have been issued yet'}
                  action={canCreate ? { label: 'New Write-Up', onClick: () => navigate('/app/performancewarnings/new') } : undefined}
                />
              ) : paginatedItems.map((w: WriteUp) => (
                <TableRow
                  key={w.id}
                  className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/performancewarnings/${w.id}`)}
                >
                  <TableCell className="text-[11px] text-slate-400 font-mono">#{w.id}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{WRITE_UP_TYPE_LABELS[w.document_type] ?? w.document_type}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{w.csr_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{STATUS_LABELS[w.status] ?? w.status}</TableCell>
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
                      onClick={() => navigate(`/app/performancewarnings/${w.id}`)}
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
        totalPages={Math.max(1, Math.ceil(filtered.length / pageSize))}
        totalItems={displayTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </QualityListPage>
  )
}
