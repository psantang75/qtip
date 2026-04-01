import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Eye, FileWarning } from 'lucide-react'
import writeupService from '@/services/writeupService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { useListSort } from '@/hooks/useListSort'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { WriteUpTypeBadge, WRITE_UP_STATUS_LABELS } from './WriteUpsPage'

const ALL_STATUS_OPTIONS = Object.values(WRITE_UP_STATUS_LABELS)

export default function MyWriteUpsPage() {
  const navigate = useNavigate()

  const { get, setMany, reset, hasAnyFilter } = useUrlFilters({
    statuses: '', types: '', from: '', to: '', page: '1', size: '20',
  })

  const statusParam = get('statuses')
  const typeParam   = get('types')
  const dateFrom    = get('from')
  const dateTo      = get('to')
  const page        = parseInt(get('page')) || 1
  const pageSize    = parseInt(get('size')) || 20

  const selectedStatuses = useMemo(
    () => statusParam ? statusParam.split(',').filter(Boolean) : [],
    [statusParam],
  )
  const selectedTypes = useMemo(
    () => typeParam ? typeParam.split(',').filter(Boolean) : [],
    [typeParam],
  )

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-writeups'],
    queryFn:  () => writeupService.getWriteUps({ limit: 200 }),
  })

  const allItems = data?.items ?? []

  const pendingSignature = useMemo(
    () => allItems.filter(w => w.status === 'AWAITING_SIGNATURE').length,
    [allItems],
  )

  const filtered = useMemo(() => {
    let items = allItems
    if (selectedStatuses.length)
      items = items.filter(w => selectedStatuses.includes(WRITE_UP_STATUS_LABELS[w.status]))
    if (selectedTypes.length)
      items = items.filter(w => selectedTypes.includes(w.document_type))
    if (dateFrom || dateTo) {
      items = items.filter(w => {
        const d = w.meeting_date?.slice(0, 10) ?? w.created_at?.slice(0, 10) ?? ''
        if (dateFrom && d < dateFrom) return false
        if (dateTo   && d > dateTo)   return false
        return true
      })
    }
    return items
  }, [allItems, selectedStatuses, selectedTypes, dateFrom, dateTo])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const items      = sorted.slice((page - 1) * pageSize, page * pageSize)

  const typeOptions = useMemo(
    () => [...new Set(allItems.map(w => w.document_type))],
    [allItems],
  )

  return (
    <QualityListPage>
      <QualityPageHeader
        title={
          <span className="flex items-center gap-3">
            My Write-Ups
            {pendingSignature > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                {pendingSignature} awaiting signature
              </span>
            )}
          </span>
        }
      />

      <QualityFilterBar
        hasFilters={hasAnyFilter}
        onReset={reset}
        resultCount={{ filtered: sorted.length, total: allItems.length }}
      >
        <StagedMultiSelect
          options={ALL_STATUS_OPTIONS}
          selected={selectedStatuses}
          onApply={v => setMany({ statuses: v.join(','), page: '1' })}
          placeholder="All Statuses"
          width="w-[200px]"
        />
        <StagedMultiSelect
          options={typeOptions}
          selected={selectedTypes}
          onApply={v => setMany({ types: v.join(','), page: '1' })}
          placeholder="All Types"
          width="w-[200px]"
        />
        <DateRangeFilter
          value={{ start: dateFrom, end: dateTo }}
          onChange={r => setMany({ from: r.start, to: r.end, page: '1' })}
        />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={5} />
        ) : isError ? (
          <TableErrorState message="Failed to load write-ups." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <TableHead className="min-w-[160px]">Document Type</TableHead>
                <SortableTableHead field="status"       sort={sort} dir={dir} onSort={toggle} className="min-w-[160px]">Status</SortableTableHead>
                <SortableTableHead field="meeting_date" sort={sort} dir={dir} onSort={toggle} className="min-w-[130px]">Meeting Date</SortableTableHead>
                <TableHead className="min-w-[140px]">Issued By</TableHead>
                <TableHead className="w-20" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableEmptyState colSpan={5} icon={FileWarning}
                  title="No write-ups found"
                  description={hasAnyFilter ? 'Try adjusting your filters' : 'Your write-ups will appear here'} />
              ) : items.map(w => (
                <TableRow
                  key={w.id}
                  className={cn(
                    'cursor-pointer hover:bg-slate-50/50',
                    w.status === 'AWAITING_SIGNATURE' && 'bg-amber-50/40 border-l-2 border-l-amber-400',
                  )}
                  onClick={() => navigate(`/app/writeups/my/${w.id}`)}
                >
                  <TableCell><WriteUpTypeBadge type={w.document_type} /></TableCell>
                  <TableCell><StatusBadge status={w.status} /></TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {w.meeting_date
                      ? formatQualityDate(w.meeting_date)
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">{w.created_by_name}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                      onClick={() => navigate(`/app/writeups/my/${w.id}`)}>
                      <Eye className="h-3.5 w-3.5" />
                      {w.status === 'AWAITING_SIGNATURE' ? 'Sign' : 'View'}
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
        onPageChange={p => setMany({ page: String(p) })}
        onPageSizeChange={s => setMany({ size: String(s), page: '1' })}
      />
    </QualityListPage>
  )
}
