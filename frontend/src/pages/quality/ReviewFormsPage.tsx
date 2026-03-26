import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PlayCircle, ClipboardList } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { DateRangeFilter, type DateRange } from '@/components/common/DateRangeFilter'
import { useListSort } from '@/hooks/useListSort'

export default function ReviewFormsPage() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const [search, setSearch]       = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' })
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(20)

  // Access guard
  if (user && user.role_id !== 1 && user.role_id !== 2) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">
          This page is only accessible to QA analysts and Administrators.
        </div>
      </div>
    )
  }

  const { data: rawForms = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['review-forms-list'],
    queryFn: () => qaService.getForms({ is_active: true }),
  })

  const interactionTypes = useMemo(() => {
    const types = new Set((rawForms as any[]).map((f: any) => f.interaction_type).filter(Boolean))
    return Array.from(types) as string[]
  }, [rawForms])

  const filtered = useMemo(() =>
    (rawForms as any[]).filter(f => {
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
    }),
    [rawForms, search, typeFilter, dateRange],
  )

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const forms      = sorted.slice((page - 1) * pageSize, page * pageSize)

  const hasFilters = search !== '' || typeFilter !== 'all' || !!dateRange.start || !!dateRange.end
  const resetFilters = () => { setSearch(''); setTypeFilter('all'); setDateRange({ start: '', end: '' }); setPage(1) }

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Review Forms"

        onRefresh={refetch}
      />

      <QualityFilterBar
        search={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search form name…"
        selects={[{
          id: 'type',
          value: typeFilter,
          onChange: v => { setTypeFilter(v); setPage(1) },
          placeholder: 'All Types',
          width: 'w-[160px]',
          options: [
            { value: 'all', label: 'All Types' },
            ...interactionTypes.map(t => ({ value: t, label: t })),
          ],
        }]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ filtered: sorted.length, total: (rawForms as any[]).length }}
      >
        <DateRangeFilter value={dateRange} onChange={v => { setDateRange(v); setPage(1) }} />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <TableErrorState message="Failed to load forms." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Form Name</SortableTableHead>
                <SortableTableHead field="interaction_type" sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Type</SortableTableHead>
                <SortableTableHead field="version"          sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Version</SortableTableHead>
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Created</SortableTableHead>
                <TableHead className="py-4">Status</TableHead>
                <TableHead className="py-4 w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.length === 0 ? (
                <TableEmptyState
                  colSpan={6}
                  icon={ClipboardList}
                  title={hasFilters ? 'No matching forms.' : 'No active forms found.'}
                  description={hasFilters ? undefined : 'Create a form in the Form Builder first.'}
                  action={hasFilters ? { label: 'Clear filters', onClick: resetFilters } : undefined}
                />
              ) : forms.map((f: any) => (
                <TableRow key={f.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-[13px] font-medium text-slate-900">{f.form_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{f.interaction_type ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">v{f.version ?? 1}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-emerald-700">Active</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                      onClick={() => navigate(`/app/quality/audit?formId=${f.id}`)}>
                      <PlayCircle size={12} className="mr-1" /> Start Review
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
        totalPages={totalPages}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </QualityListPage>
  )
}
