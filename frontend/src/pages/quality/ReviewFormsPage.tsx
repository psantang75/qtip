import { useNavigate, Navigate } from 'react-router-dom'
import { PlayCircle, ClipboardList } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useQualityRole } from '@/hooks/useQualityRole'
import { useActiveForms } from '@/hooks/useQualityQueries'
import type { FormSummary } from '@/services/qaService'
import { useFormListFilters } from '@/hooks/useFormListFilters'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { StatusBadge } from '@/components/common/StatusBadge'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { useListSort } from '@/hooks/useListSort'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { RowActionButton } from '@/components/common/RowActionButton'
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
  } = useFormListFilters(rawForms as FormSummary[])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const forms      = sorted.slice((page - 1) * pageSize, page * pageSize)

  const { isAdminOrQA } = useQualityRole()
  if (user && !isAdminOrQA) {
    return <Navigate to="/app/quality/submissions" replace />
  }

  return (
    <ListPageShell>
      <ListPageHeader title="Review Forms" />

      <ListFilterBar
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
      </ListFilterBar>

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={6} />
        ) : isError ? (
          <TableErrorState message="Failed to load forms." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="form_name"        sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Name</SortableTableHead>
                <SortableTableHead field="is_active"        sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Status</SortableTableHead>
                <SortableTableHead field="interaction_type" sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Type</SortableTableHead>
                <SortableTableHead field="version"          sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Version</SortableTableHead>
                <SortableTableHead field="created_at"       sort={sort} dir={dir} onSort={v => { toggle(v); setPage(1) }}>Created On</SortableTableHead>
                <TableHead className="py-4 w-[140px]" />
              </StandardTableHeaderRow>
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
              ) : forms.map((f: FormSummary) => (
                <TableRow
                  key={f.id}
                  className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/quality/audit?formId=${f.id}`)}
                >
                  <TableCell className="text-[13px] text-slate-600">{f.form_name}</TableCell>
                  <TableCell><StatusBadge status={f.is_active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                  <TableCell className="text-[13px] text-slate-600">{f.interaction_type ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">v{f.version ?? 1}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">
                    {formatQualityDate(f.created_at)}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <RowActionButton icon={PlayCircle}
                      onClick={() => navigate(`/app/quality/audit?formId=${f.id}`)}>
                      Start Review
                    </RowActionButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </ListPageShell>
  )
}
