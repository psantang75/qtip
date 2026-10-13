/** Flat result table for an ungrouped On-Demand Report. */
import type { OnDemandReportColumn } from '@/services/onDemandReportsService'
import { alignClass, renderCell } from './onDemandFormat'

interface OnDemandResultsTableProps {
  columns: OnDemandReportColumn[]
  rows: Record<string, unknown>[]
}

export default function OnDemandResultsTable({ columns, rows }: OnDemandResultsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-slate-400 border-b border-slate-200">
            {columns.map(c => (
              <th key={c.key} className={`py-2 px-2 font-medium ${alignClass(c.align)}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              {columns.map(c => (
                <td key={c.key} className={`py-1.5 px-2 text-slate-700 ${alignClass(c.align)}`}>
                  {renderCell(row[c.key], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
