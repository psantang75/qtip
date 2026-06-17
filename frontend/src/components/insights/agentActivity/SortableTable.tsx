import { useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type SortingState, type ColumnDef,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
}

/**
 * Shared sortable table for the Agent Activity reports. Every column shows a
 * sort affordance (neutral ⇅ until active), values are left-aligned to match
 * the source reports, and a "Reset Sort" button appears once the sort differs
 * from the table's default.
 */
export default function SortableTable<T>({
  columns, data, initialSorting, totalRow, minWidth = 'min-w-[720px]',
}: SortableTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)

  const table = useReactTable({
    data, columns,
    state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
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
        <table className={`w-full text-sm table-fixed ${minWidth}`}>
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
                        {sorted === 'asc'  ? <ChevronUp size={12} />
                          : sorted === 'desc' ? <ChevronDown size={12} />
                          : <ChevronsUpDown size={12} className="opacity-40" />}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
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
    </div>
  )
}
