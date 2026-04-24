/**
 * Analytics Excel workbook builder.
 *
 * Extracted from the legacy `AnalyticsService.generateExcelExport(...)`
 * + `addDataRows(...)` during pre-production cleanup item #29. The
 * worksheet layout, column widths, alignment, percentage formatting
 * and conditional column inclusion all live here so the report
 * service can stay focused on data shaping.
 *
 * Note: this is the canonical Excel writer for analytics. See
 * pre-production cleanup item #24 for the broader work to converge
 * the codebase on a single ExcelJS pipeline.
 */

import ExcelJS from 'exceljs'

const HEADER_BG_BLACK = 'FF000000'
const TITLE_BG_BLUE = 'FF00AEEF'
const HEADER_TEXT_WHITE = 'FFFFFFFF'

const BASE_COLUMNS = [
  'submission_id',
  'submission_date',
  'csr_name',
  'form_name',
  'total_score',
] as const

const HEADER_LABELS: Record<string, string> = {
  submission_id: 'Submission ID',
  submission_date: 'Date',
  csr_name: 'CSR',
  form_name: 'Form',
  total_score: 'Form Score',
  category_name: 'Category',
  category_id: 'Category ID',
  category_score: 'Category Score',
  question: 'Question',
  question_text: 'Question',
  question_answer: 'Answer',
  question_answer_value: 'Answer Value',
  question_value: 'Value',
  question_total_value: 'Total Value',
  responses: 'Responses',
  average_score: 'Average Score',
  question_average_score: 'Question Score',
  status: 'Status',
  submitted_at: 'Submitted At',
  form_id: 'Form ID',
  csr_id: 'CSR ID',
  department_id: 'Department ID',
  department_name: 'Department',
  qa_id: 'QA ID',
  qa_name: 'QA Name',
}

const LEFT_ALIGN_COLUMNS = new Set([
  'submission_date', 'csr_name', 'form_name', 'category_name',
  'question', 'question_text', 'question_answer', 'question_value',
])

const RIGHT_ALIGN_COLUMNS = new Set([
  'total_score', 'category_score', 'question_average_score',
  'average_score', 'question_total_value',
])

function pickColumns(allHeaders: string[], data: any[]): string[] {
  const has = (header: string, predicate?: (row: any) => boolean): boolean =>
    allHeaders.includes(header)
      && (!predicate || data.some(predicate))

  const headers: string[] = [...BASE_COLUMNS]

  if (has('category_name', r => r.category_name)) headers.push('category_name')
  if (has('category_score', r => r.category_score !== undefined && r.category_score !== null)) {
    headers.push('category_score')
  }
  if (allHeaders.includes('question') || allHeaders.includes('question_text')) {
    headers.push(allHeaders.includes('question') ? 'question' : 'question_text')
  }
  if (allHeaders.includes('question_answer')) headers.push('question_answer')
  if (has('question_value', r =>
    r.question_value !== undefined && r.question_value !== null && r.question_value !== '',
  )) headers.push('question_value')
  if (has('question_total_value', r =>
    r.question_total_value !== undefined && r.question_total_value !== null,
  )) headers.push('question_total_value')

  return headers.filter(h => allHeaders.includes(h))
}

function columnWidth(header: string): number {
  if (header === 'submission_id') return 15
  if (header.includes('id')) return 12
  if (header.includes('date')) return 15
  if (header === 'category_score') return 15
  if (header.includes('score')) return 12
  if (header === 'category_name') return 30
  if (header === 'question' || header === 'question_text') return 25
  return 25
}

function applyHeaderStyle(cell: ExcelJS.Cell, header: string, width: number): void {
  cell.font = { bold: true, size: 11, color: { argb: HEADER_TEXT_WHITE } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_BLACK } }
  cell.alignment = {
    vertical: 'middle',
    horizontal: LEFT_ALIGN_COLUMNS.has(header) ? 'left' : 'center',
    wrapText: header === 'category_name' || header === 'question' || header === 'question_text',
  }
  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }
  cell.worksheet.getColumn(cell.col).width = width
}

function applyDataCell(cell: ExcelJS.Cell, header: string, row: any): void {
  let value = row[header]

  if (header === 'question_average_score' && value !== null && value !== undefined) {
    value = value * 100
  }

  if (header === 'category_score' && (
    value === 'N/A' || value === null || value === undefined
    || row.category_possible_points === 0
    || (value === 0 && row.category_possible_points === 0)
  )) {
    cell.value = 'N/A'
  } else {
    cell.value = value
  }

  if (header.includes('score') && cell.value !== 'N/A') {
    cell.numFmt = '0.00"%"'
  }
  if (header.includes('date')) {
    cell.numFmt = 'yyyy-mm-dd'
  }

  cell.alignment = LEFT_ALIGN_COLUMNS.has(header)
    ? { vertical: 'top', horizontal: 'left' }
    : RIGHT_ALIGN_COLUMNS.has(header)
      ? { vertical: 'top', horizontal: 'right' }
      : { vertical: 'top', horizontal: 'left' }

  if (header === 'category_name' || header === 'question' || header === 'question_text') {
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
  }

  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }
}

function sortAnalyticsRows(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const idA = parseInt(a.submission_id, 10) || 0
    const idB = parseInt(b.submission_id, 10) || 0
    if (idA !== idB) return idA - idB

    const catA = String(a.category_name || '').toLowerCase()
    const catB = String(b.category_name || '').toLowerCase()
    if (catA !== catB) return catA < catB ? -1 : 1

    const qA = String(a.question_text || a.question || '').toLowerCase()
    const qB = String(b.question_text || b.question || '').toLowerCase()
    return qA < qB ? -1 : qA > qB ? 1 : 0
  })
}

function writeDataRows(
  worksheet: ExcelJS.Worksheet,
  data: any[],
  startRow: number,
): number {
  let currentRow = startRow

  if (!data || data.length === 0) {
    worksheet.getRow(currentRow).getCell(1).value = 'No data available'
    return currentRow + 1
  }

  const allHeaders = Object.keys(data[0])
  const headers = pickColumns(allHeaders, data)

  // Pre-set the column-level alignment for category_score so empty
  // cells inherit right-alignment, not just the explicitly written ones.
  const catScoreIdx = headers.indexOf('category_score')
  if (catScoreIdx !== -1) {
    worksheet.getColumn(catScoreIdx + 1).alignment = { vertical: 'top', horizontal: 'right' }
  }

  const headerRow = worksheet.getRow(currentRow)
  headers.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = HEADER_LABELS[header]
      ?? header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    applyHeaderStyle(cell, header, columnWidth(header))
  })
  currentRow += 1

  data.forEach(row => {
    const dataRow = worksheet.getRow(currentRow)
    headers.forEach((header, idx) => {
      applyDataCell(dataRow.getCell(idx + 1), header, row)
    })
    currentRow += 1
  })

  return currentRow
}

/**
 * Build the analytics workbook. Returns a binary Buffer ready to be
 * streamed via `Content-Disposition: attachment`.
 */
export async function generateAnalyticsExcel(rawData: any[]): Promise<Buffer> {
  const sortedData = sortAnalyticsRows(rawData)
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('QTIP Analytics Report')

  const allHeaders = sortedData.length > 0 ? Object.keys(sortedData[0]) : []
  const numColumns = pickColumns(allHeaders, sortedData).length

  let currentRow = 1
  const titleRow = worksheet.getRow(currentRow)
  const titleCell = titleRow.getCell(1)
  titleCell.value = 'QTIP ANALYTICS - RAW SCORE DATA'
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF000000' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG_BLUE } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  titleRow.height = 30
  worksheet.mergeCells(currentRow, 1, currentRow, Math.max(numColumns, 5))
  currentRow += 2

  writeDataRows(worksheet, sortedData, currentRow)

  // Right-align every score column post-write to catch any cells the
  // per-row pass missed (e.g. blank cells that still need alignment).
  worksheet.columns?.forEach(column => {
    const header = column.header?.toString()
    if (!header) return
    if (!header.toLowerCase().includes('score')) return
    column.eachCell?.((cell, rowNumber) => {
      if (rowNumber > 1) {
        cell.alignment = { vertical: 'top', horizontal: 'right' }
      }
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
