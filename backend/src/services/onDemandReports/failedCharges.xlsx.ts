/**
 * Workbook builder for the "Failed Charge Invoices by Agent" report: one sheet of
 * every row, or one tab per rep. Header styling mirrors the Coaching Sessions export.
 */
import ExcelJS from 'exceljs'
import { FAILED_CHARGE_COLUMNS, type FailedChargeRow } from './failedCharges.data'

const COLUMN_WIDTHS: Record<string, number> = {
  rep_name: 24, decline_reason: 28, recovery_path: 22, campaign: 20,
  processed_by: 26, processor_type: 16, task_link: 60,
}
const MONEY_KEYS = new Set(['invoiced', 'recovered', 'outstanding'])
const MAX_SHEET_NAME = 31

/**
 * Excel's sheet-name rules: at most 31 characters, none of `[]:*?/\`, not blank, and
 * unique within the workbook (case-insensitively).
 */
export function uniqueSheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SHEET_NAME) || 'Sheet'
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`
    name = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trimEnd()}${suffix}`
  }
  taken.add(name.toLowerCase())
  return name
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: FailedChargeRow[]) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = FAILED_CHARGE_COLUMNS.map(c => ({
    header: c.label, key: c.key, width: COLUMN_WIDTHS[c.key] ?? 14,
    ...(MONEY_KEYS.has(c.key) ? { style: { numFmt: '#,##0.00' } } : {}),
  }))

  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00AEEF' } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.height = 22

  for (const r of rows) {
    const row = sheet.addRow(r)
    if (r.task_link) {
      row.getCell('task_link').value = { text: r.task_link, hyperlink: r.task_link }
      row.getCell('task_link').font = { color: { argb: 'FF00AEEF' }, underline: true }
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: FAILED_CHARGE_COLUMNS.length } }
}

/** Rows grouped by rep, in the order they arrive (already rep-sorted by the loader). */
export function groupByRep(rows: FailedChargeRow[]): Map<string, FailedChargeRow[]> {
  const groups = new Map<string, FailedChargeRow[]>()
  for (const r of rows) {
    const list = groups.get(r.rep_name)
    if (list) list.push(r)
    else groups.set(r.rep_name, [r])
  }
  return groups
}

export async function buildFailedChargesWorkbook(
  rows: FailedChargeRow[],
  opts: { split?: 'tabs'; sheetName?: string } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const taken = new Set<string>()
  const groups = opts.split === 'tabs' ? groupByRep(rows) : null

  if (groups && groups.size > 0) {
    for (const [rep, repRows] of groups) addSheet(workbook, uniqueSheetName(rep, taken), repRows)
  } else {
    addSheet(workbook, uniqueSheetName(opts.sheetName ?? 'Failed Charge Invoices', taken), rows)
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
