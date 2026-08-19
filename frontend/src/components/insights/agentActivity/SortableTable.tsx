import { useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender,
  type SortingState, type PaginationState, type ColumnDef,
} from '@tanstack/react-table'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ListPagination } from '@/components/common/ListPagination'
import SortHeaderIcon from './SortHeaderIcon'

/** Column meta understood by SortableTable. */
export interface AgentColMeta {
  /** Tailwind width (e.g. 'w-[18%]') applied to the header cell. */
  width?: string
  /** Render this column's body cells bold (e.g. Total Margin). */
  bold?: boolean
}

interface SortableTableProps<T> {
  columns: ColumnDef<T, any>[]
  data: T[]
  initialSorting: SortingState
  /**
   * Optional bold footer row. Keyed by column id → cell content (the first
   * column typically holds the "Total: N" label). Columns without an entry
   * render blank.
   */
  totalRow?: Record<string, React.ReactNode>
  minWidth?: string
  /** Optional per-row <tr> classes, e.g. to grey out de-emphasized rows. */
  rowClassName?: (row: T) => string
  /** Optional row click handler; when set, rows get a pointer cursor. */
  onRowClick?: (row: T) => void
  /**
   * Enable client-side pagination with the shared `ListPagination` footer.
   * Sorting always applies across the full dataset first, then the visible
   * page is sliced — so sorting a paginated table sorts everything, not just
   * the current page. Off by default (all rows render).
   */
  paginated?: boolean
  /** Initial rows per page (paginated only). Defaults to 20. */
  initialPageSize?: number
  /** Rows-per-page options for the footer select (paginated only). */
  pageSizeOptions?: number[]
}

/**
 * Shared sortable table for the Agent Activity reports. Every column shows a
 * sort affordance (neutral ⇅ until active), values are left-aligned to match
 * the source reports, and a "Reset Sort" button appears once the sort differs
 * from the table's default.
 */
export default function SortableTable<T>({
  columns, data, initialSorting, totalRow, minWidth = 'min-w-[720px]', rowClassName, onRowClick,
  paginated = false, initialPageSize = 20, pageSizeOptions,
}: SortableTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: initialPageSize })

  const table = useReactTable({
    data, columns,
    state: { sorting, ...(paginated ? { pagination } : {}) },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    ...(paginated
      ? { onPaginationChange: setPagination, getPaginationRowModel: getPaginationRowModel() }
      : {}),
  })

  const isDirty = !(
    sorting.length === initialSorting.length &&
    sorting.every((s, i) => s.id === initialSorting[i]?.id && s.desc === initialSorting[i]?.desc)
  )

  const metaOf = (col: { columnDef: { meta?: unknown } }) => (col.columnDef.meta as AgentColMeta | undefined) ?? {}

  return (
    <div>
      <div className="flex justify-end h-7 mb-1">
        {isDirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSorting(initialSorting)}
            className="h-7 text-[12px] text-slate-500 hover:text-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset Sort
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className={`w-full text-sm table-fixed ${minWidth} [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4`}>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="text-xs text-slate-400 border-b border-slate-200">
                {hg.headers.map(header => {
                  const meta = metaOf(header.column)
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      className={`text-left pb-2 pr-4 font-medium select-none cursor-pointer ${meta.width ?? ''}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortHeaderIcon sorted={sorted} canSort={header.column.getCanSort()} />
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr
                key={row.id}
                className={`border-b border-slate-100 hover:bg-slate-50 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row.original) ?? ''}`}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map(cell => {
                  const meta = metaOf(cell.column)
                  return (
                    <td key={cell.id} className={`py-2.5 pr-4 ${meta.bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={columns.length} className="py-8 text-center text-sm text-slate-400">No data.</td></tr>
            )}
            {totalRow && (
              <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                {table.getAllLeafColumns().map(col => (
                  <td key={col.id} className="py-2.5 pr-4">{totalRow[col.id] ?? ''}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paginated && data.length > 0 && (
        <div className="mt-3">
          <ListPagination
            page={table.getState().pagination.pageIndex + 1}
            totalPages={table.getPageCount()}
            totalItems={data.length}
            pageSize={table.getState().pagination.pageSize}
            onPageChange={p => table.setPageIndex(p - 1)}
            onPageSizeChange={s => { table.setPageSize(s); table.setPageIndex(0) }}
            {...(pageSizeOptions ? { pageSizeOptions } : {})}
          />
        </div>
      )}
    </div>
  )
}
