/** Cell rendering for On-Demand Report result tables, driven by each column's hints. */
import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import type { OnDemandReportColumn } from '@/services/onDemandReportsService'

export function alignClass(align: OnDemandReportColumn['align']): string {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

export function formatCellValue(
  value: unknown,
  format: OnDemandReportColumn['format'] | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  if (format === 'percent') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!isFinite(n)) return String(value)
    return `${n.toFixed(2)}%`
  }
  if (format === 'date') {
    if (value instanceof Date) return value.toISOString().split('T')[0]
    return String(value).split('T')[0]
  }
  if (format === 'number' || typeof value === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!isFinite(n)) return String(value)
    return Number.isInteger(n) ? n.toString() : n.toFixed(2)
  }
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return String(value)
}

/** A cell's content: an external link for `link` columns, formatted text otherwise. */
export function renderCell(value: unknown, column: OnDemandReportColumn): ReactNode {
  if (column.format === 'link') {
    if (!value) return ''
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        Open <ExternalLink className="h-3 w-3" />
      </a>
    )
  }
  return formatCellValue(value, column.format)
}
