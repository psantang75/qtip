import { useNavigate, Navigate } from 'react-router-dom'
import { PlayCircle, ClipboardList } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useQualityRole } from '@/hooks/useQualityRole'
import { useActiveForms } from '@/hooks/useQualityQueries'
import { useFormListFilters } from '@/hooks/useFormListFilters'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { useListSort } from '@/hooks/useListSort'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { formatQualityDate } from '@/utils/dateFormat'

export default function ReviewFormsPage() {
  const { user }  = useAuth()
  const navigate  = useNavigate()

  const { data: rawForms = [], isLoading, isError, refetch } = useActiveForms()

  const {
    selectedFormNames, setSelectedFormNames,
    formNames,
    selectedTypes, setSelectedTypes,
    interactionTypes,
    page, setPage,
    pageSize, setPageSize,
    filtered,
    hasFilters,
    resetFilters,
  } = useFormListFilters(rawForms as any[])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const forms      = sorted.slice((page - 1) * pageSize, page * pageSize)

  const { isAdminOrQA } = useQualityRole()
  if (user && !isAdminOrQA) {
    return <Navigate to="/app/quality/submissions" replace />
  }

  return (
    <QualityListPage>
      <QualityPageHeader title="Review Forms" />

      <QualityFilterBar
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ filtered: sorted.length, total: (rawForms as any[]).length }}
      >
        <StagedMultiSelect
          options={formNames}
          selected={selectedFormNames}
          onApply={v => { setSelectedFormNames(v); setPage(1) }}
          placeholder="All Forms"
          width="w-[340px]"
        />
        <StagedMultiSelect
          options={interactionTypes}
          selected={selectedTypes}
          onApply={v => { setSelectedTypes(v); setPage(1) }}
          placeholder="All Types"
          width="w-[160px]"
        />
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={6} />
        ) : isError ? (
          <TableErrorState message="Failed to load forms." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Name</SortableTableHead>
                <SortableTableHead field="is_active"        sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Status</SortableTableHead>
                <SortableTableHead field="interaction_type" sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Type</SortableTableHead>
                <SortableTableHead field="version"          sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Version</SortableTableHead>
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Created On</SortableTableHead>
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
                  <TableCell className="text-[13px] text-slate-600">
                    {f.is_active ? 'Active' : 'Inactive'}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">{f.interaction_type ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">v{f.version ?? 1}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">
                    {formatQualityDate(f.created_at)}
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
