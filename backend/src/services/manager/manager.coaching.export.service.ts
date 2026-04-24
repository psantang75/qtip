/**
 * Excel export of coaching sessions visible to the caller.
 *
 * GET /api/manager/coaching-sessions/export
 *
 * Mirrors the list endpoint's filters via `buildCoachingWhere` so exports
 * always match the data the user is looking at on screen.
 */
import ExcelJS from 'exceljs'
import prisma from '../../config/prisma'
import {
  buildCoachingWhere,
  type CoachingFilters,
  type CoachingScope,
} from './manager.coaching.query'

export interface ExportCoachingParams extends CoachingScope {
  filters: CoachingFilters
}

export interface CoachingExportResult {
  buffer: Buffer
  fileName: string
  mimeType: string
}

function buildFileName(): string {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-')
  return `QTIP_CoachingSessions_${dateStr}_${timeStr}.xlsx`
}

function formatStatus(value: string | null): string {
  if (!value) return ''
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

function formatDate(value: Date | string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('en-US') : ''
}

export async function exportManagerCoachingSessions(
  params: ExportCoachingParams,
): Promise<CoachingExportResult> {
  const where = await buildCoachingWhere(
    { userId: params.userId, userRole: params.userRole },
    params.filters,
  )

  const sessions = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       cs.id,
       cs.session_date,
       cs.coaching_type,
       cs.notes,
       cs.status,
       cs.attachment_filename,
       cs.created_at,
       u.username as csr_name,
       creator.username as created_by_name,
       GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     JOIN departments d ON u.department_id = d.id
     LEFT JOIN users creator ON cs.created_by = creator.id
     LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
     LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
     ${where.whereSql}
     GROUP BY cs.id
     ORDER BY cs.session_date DESC`,
    ...where.params,
  )

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Coaching Sessions')

  worksheet.columns = [
    { header: 'Session ID', key: 'id', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Coaching Type', key: 'coaching_type', width: 20 },
    { header: 'CSR Name', key: 'csr_name', width: 24 },
    { header: 'Topics', key: 'topics', width: 36 },
    { header: 'Manager/Trainer', key: 'created_by_name', width: 24 },
    { header: 'Session Date', key: 'session_date', width: 16 },
    { header: 'Created At', key: 'created_at', width: 16 },
    { header: 'Notes', key: 'notes', width: 48 },
    { header: 'Attachment', key: 'attachment_filename', width: 28 },
  ]

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00AEEF' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 22

  for (const session of sessions) {
    worksheet.addRow({
      id: `#${session.id}`,
      status: formatStatus(session.status as string),
      coaching_type: session.coaching_type || '',
      csr_name: session.csr_name || '',
      topics: session.topics || '',
      created_by_name: session.created_by_name || 'Unknown',
      session_date: formatDate(session.session_date as Date | string | null),
      created_at: formatDate(session.created_at as Date | string | null),
      notes: session.notes || '',
      attachment_filename: session.attachment_filename || '',
    })
  }

  worksheet.eachRow((row, rowNumber) => {
    row.alignment = {
      vertical: 'top',
      horizontal: rowNumber === 1 ? 'center' : 'left',
      wrapText: true,
    }
  })

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length },
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

  return {
    buffer,
    fileName: buildFileName(),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}
