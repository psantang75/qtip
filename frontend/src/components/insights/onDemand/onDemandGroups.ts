import type { OnDemandReportColumn } from '@/services/onDemandReportsService'

export interface ResultGroup {
  name: string
  rows: Record<string, unknown>[]
  /** Sum of each summable column (right-aligned numbers), keyed by column key. */
  sums: Record<string, number>
}

/** Right-aligned numeric columns are the ones a group total makes sense for. */
export const summableColumns = (columns: OnDemandReportColumn[]) =>
  columns.filter(c => c.align === 'right' && c.format === 'number')

/** Rows bucketed by `key`, in first-seen order (the server already sorts them). */
export function groupRows(
  rows: Record<string, unknown>[],
  key: string,
  columns: OnDemandReportColumn[],
): ResultGroup[] {
  const sumKeys = summableColumns(columns).map(c => c.key)
  const groups = new Map<string, ResultGroup>()
  for (const row of rows) {
    const name = String(row[key] ?? '')
    let g = groups.get(name)
    if (!g) {
      g = { name, rows: [], sums: Object.fromEntries(sumKeys.map(k => [k, 0])) }
      groups.set(name, g)
    }
    g.rows.push(row)
    for (const k of sumKeys) g.sums[k] += Number(row[k]) || 0
  }
  return [...groups.values()]
}
