import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Pencil, Eye, Copy, ClipboardList } from 'lucide-react'
import qaService from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useListSort } from '@/hooks/useListSort'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'

interface FormBuilderListProps {
  onEdit:      (id: number) => void
  onCreate:    () => void
  onPreview:   (id: number) => void
  onDuplicate: (id: number) => void
}

export function FormBuilderList({ onEdit, onCreate, onPreview, onDuplicate }: FormBuilderListProps) {
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [dateRange, setDateRange]       = useState<DateRange>({ start: '', end: '' })
  const [page, setPage]                 = useState(1)
  const [pageSize, setPageSize]         = useState(20)

  // Always load all forms — active/inactive filtering is done client-side below
  const { data: rawForms = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['forms-list'],
    queryFn: () => qaService.getForms(),
    staleTime: 30 * 1000,
  })

  const interactionTypes = useMemo(() => {
    const types = new Set((rawForms as any[]).map((f: any) => f.interaction_type).filter(Boolean))
    return Array.from(types) as string[]
  }, [rawForms])

  const filtered = useMemo(() => (rawForms as any[]).filter(f => {
    // Active / Inactive filter — client-side, always reliable
    if (statusFilter === 'active'   && !f.is_active) return false
    if (statusFilter === 'inactive' &&  f.is_active) return false
    if (search && !f.form_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (typeFilter !== 'all' && f.interaction_type !== typeFilter) return false
    if (dateRange.start) {
      const created = f.created_at ? f.created_at.split('T')[0] : ''
      if (created && created < dateRange.start) return false
    }
    if (dateRange.end) {
      const created = f.created_at ? f.created_at.split('T')[0] : ''
      if (created && created > dateRange.end) return false
    }
    return true
  }), [rawForms, statusFilter, search, typeFilter, dateRange])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const displayed  = sorted.slice((page - 1) * pageSize, page * pageSize)

  const hasFilters = search !== '' || statusFilter !== 'active' || typeFilter !== 'all' || !!dateRange.start || !!dateRange.end

  const resetFilters = () => {
    setSearch(''); setStatusFilter('active'); setTypeFilter('all')
    setDateRange({ start: '', end: '' }); setPage(1)
  }

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Form Builder"

        actions={
          <Button onClick={onCreate} className="gap-1.5">
            <Plus size={15} /> New Form
          </Button>
        }
        onRefresh={refetch}
      />

      <QualityFilterBar
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search form name…"
        selects={[
          {
            id: 'status',
            value: statusFilter,
            onChange: v => { setStatusFilter(v); setPage(1) },
            options: [
              { value: 'all',      label: 'All Status' },
              { value: 'active',   label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
          {
            id: 'type',
            value: typeFilter,
            onChange: v => { setTypeFilter(v); setPage(1) },
            placeholder: 'All Types',
            width: 'w-[150px]',
            options: [
              { value: 'all', label: 'All Types' },
              ...interactionTypes.map(t => ({ value: t, label: t })),
            ],
          },
        ]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ filtered: sorted.length, total: (rawForms as any[]).length }}
      >
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <TableErrorState message="Failed to load forms." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={toggle}>Form Name</SortableTableHead>
                <SortableTableHead field="interaction_type" sort={sort} dir={dir} onSort={toggle}>Type</SortableTableHead>
                <SortableTableHead field="version"          sort={sort} dir={dir} onSort={toggle}>Version</SortableTableHead>
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={toggle}>Created</SortableTableHead>
                <SortableTableHead field="is_active"        sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <TableHead className="py-4 w-[140px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableEmptyState
                  colSpan={6}
                  icon={ClipboardList}
                  title={hasFilters ? 'No matching forms.' : 'No forms yet.'}
                  description={hasFilters ? undefined : 'Create your first QA form to get started.'}
                  action={hasFilters ? { label: 'Clear filters', onClick: resetFilters } : undefined}
                />
              ) : displayed.map((f: any) => (
                <TableRow key={f.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-[13px] font-medium text-slate-900">{f.form_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{f.interaction_type ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">v{f.version ?? 1}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={f.is_active ? 'ACTIVE' : 'INACTIVE'} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => onEdit(f.id)}>
                        <Pencil size={12} className="mr-1" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => onPreview(f.id)}>
                        <Eye size={12} className="mr-1" /> Preview
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => onDuplicate(f.id)}>
                        <Copy size={12} className="mr-1" /> Duplicate
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </QualityListPage>
  )
}
