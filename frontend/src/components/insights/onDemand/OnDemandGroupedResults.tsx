/**
 * Results for a grouped On-Demand Report: one line per group (e.g. per rep) with
 * its row count, column totals and its own download; the caret expands the line
 * to show the rows that download would contain.
 */
import { Fragment, useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getExpandedRowModel, flexRender, type ColumnDef,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OnDemandReportColumn } from '@/services/onDemandReportsService'
import OnDemandResultsTable from './OnDemandResultsTable'
import { formatCellValue } from './onDemandFormat'
import { groupRows, summableColumns, type ResultGroup } from './onDemandGroups'

interface OnDemandGroupedResultsProps {
  columns: OnDemandReportColumn[]
  rows: Record<string, unknown>[]
  groupBy: { key: string; label: string }
  onDownloadGroup: (group: string) => void
  /** The group whose download is in flight, if any. */
  downloadingGroup: string | null
}

export default function OnDemandGroupedResults({
  columns, rows, groupBy, onDownloadGroup, downloadingGroup,
}: OnDemandGroupedResultsProps) {
  const groups = useMemo(() => groupRows(rows, groupBy.key, columns), [rows, groupBy.key, columns])
  // The group's own name is the line's label, so the expanded rows drop that column.
  const detailColumns = useMemo(() => columns.filter(c => c.key !== groupBy.key), [columns, groupBy.key])
  const [expanded, setExpanded] = useState({})

  const tableColumns = useMemo<ColumnDef<ResultGroup>[]>(() => [
    {
      id: 'name',
      header: groupBy.label,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={row.getToggleExpandedHandler()}
          aria-expanded={row.getIsExpanded()}
          className="h-7 px-1 -ml-1 font-medium text-slate-900 hover:bg-transparent hover:text-primary"
        >
          {row.getIsExpanded()
            ? <ChevronDown className="h-4 w-4 mr-1" />
            : <ChevronRight className="h-4 w-4 mr-1" />}
          {row.original.name}
        </Button>
      ),
    },
    {
      id: 'count',
      header: () => <span className="block text-right">Invoices</span>,
      cell: ({ row }) => <span className="block text-right">{row.original.rows.length.toLocaleString()}</span>,
    },
    ...summableColumns(columns).map<ColumnDef<ResultGroup>>(c => ({
      id: c.key,
      header: () => <span className="block text-right">{c.label}</span>,
      cell: ({ row }) => <span className="block text-right">{formatCellValue(row.original.sums[c.key], 'number')}</span>,
    })),
    {
      id: 'download',
      header: () => <span className="sr-only">Download</span>,
      cell: ({ row }) => {
        const busy = downloadingGroup === row.original.name
        return (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownloadGroup(row.original.name)}
              disabled={downloadingGroup !== null}
              className="h-7 text-xs"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              {busy ? 'Generating…' : 'Download'}
            </Button>
          </div>
        )
      },
    },
  ], [columns, groupBy.label, downloadingGroup, onDownloadGroup])

  const table = useReactTable({
    data: groups,
    columns: tableColumns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  return (
    <table className="w-full text-sm">
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id} className="text-xs text-slate-400 border-b border-slate-200">
            {hg.headers.map(h => (
              <th key={h.id} className="py-2 px-2 text-left font-medium">
                {flexRender(h.column.columnDef.header, h.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map(row => (
          <Fragment key={row.id}>
            <tr className="border-b border-slate-100 hover:bg-slate-50">
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="py-1.5 px-2 text-slate-700">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
            {row.getIsExpanded() && (
              <tr className="border-b border-slate-200 bg-surface">
                <td colSpan={row.getVisibleCells().length} className="px-2 py-3">
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <OnDemandResultsTable columns={detailColumns} rows={row.original.rows} />
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
