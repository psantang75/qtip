import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Eye, Copy, ClipboardList } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAllForms } from '@/hooks/useQualityQueries'
import type { FormSummary } from '@/services/qaService'
import { useFormListFilters } from '@/hooks/useFormListFilters'
import { useListSort } from '@/hooks/useListSort'
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
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { formatQualityDate } from '@/utils/dateFormat'

const FORMS_BASE = '/app/quality/forms'

export function FormBuilderList() {
  const navigate = useNavigate()
  const { data: rawForms = [], isLoading, isError, refetch } = useAllForms()

  const {
    selectedFormNames, setSelectedFormNames,
    formNames,
    selectedTypes, setSelectedTypes,
    statusFilter, setStatusFilter,
    page, setPage,
    pageSize, setPageSize,
    interactionTypes,
    filtered,
    hasFilters,
    resetFilters,
  } = useFormListFilters(rawForms as FormSummary[], { defaultStatus: 'active' })

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const displayed  = sorted.slice((page - 1) * pageSize, page * pageSize)

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Form Builder"
        actions={
          <Button onClick={() => navigate(`${FORMS_BASE}/new`)} className="gap-1.5">
            <Plus size={15} /> New Form
          </Button>
        }
      />

      <QualityFilterBar
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ filtered: sorted.length, total: rawForms.length }}
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
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[145px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableLoadingSkeleton rows={5} />
        ) : isError ? (
          <TableErrorState message="Failed to load forms." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={toggle}>Name</SortableTableHead>
                <SortableTableHead field="is_active"        sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
                <SortableTableHead field="interaction_type" sort={sort} dir={dir} onSort={toggle}>Type</SortableTableHead>
                <SortableTableHead field="version"          sort={sort} dir={dir} onSort={toggle}>Version</SortableTableHead>
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={toggle}>Created On</SortableTableHead>
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
              ) : displayed.map((f: FormSummary) => (
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
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => navigate(`${FORMS_BASE}/${f.id}/edit`)}>
                        <Pencil size={12} className="mr-1" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => navigate(`${FORMS_BASE}/${f.id}/preview`)}>
                        <Eye size={12} className="mr-1" /> Preview
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => navigate(`${FORMS_BASE}/${f.id}/duplicate`)}>
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
