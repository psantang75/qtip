/**
 * Excel export of team disputes for a manager / admin / QA.
 *
 * GET /api/manager/disputes/export
 *
 * Reuses `buildDisputeWhere` so the export rows always match what the list
 * endpoint shows.
 */
import ExcelJS from 'exceljs'
import prisma from '../../config/prisma'
import {
  buildDisputeWhere,
  type DisputeFilters,
  type DisputeScope,
} from './manager.disputes.query'
import { ManagerServiceError } from './manager.types'

export interface ExportDisputesParams extends DisputeScope {
  filters: DisputeFilters
}

export interface DisputeExportResult {
  buffer: Buffer
  fileName: string
  mimeType: string
}

const SELECT_EXPORT = `
  SELECT
    d.id as dispute_id,
    d.submission_id,
    d.reason,
    d.status,
    d.created_at,
    d.resolved_at,
    d.resolution_notes,
    s.total_score,
    (
      SELECT dsh.score
      FROM dispute_score_history dsh
      WHERE dsh.dispute_id = d.id AND dsh.score_type = 'PREVIOUS'
      ORDER BY dsh.created_at ASC, dsh.id ASC
      LIMIT 1
    ) as previous_score,
    (
      SELECT dsh.score
      FROM dispute_score_history dsh
      WHERE dsh.dispute_id = d.id AND dsh.score_type = 'ADJUSTED'
      ORDER BY dsh.created_at DESC, dsh.id DESC
      LIMIT 1
    ) as adjusted_score,
    csr.username as csr_name,
    f.id as form_id,
    f.form_name,
    qa.username as qa_analyst_name
  FROM disputes d
  JOIN submissions s ON d.submission_id = s.id
  JOIN forms f ON s.form_id = f.id
  JOIN users csr ON d.disputed_by = csr.id
  JOIN users qa ON s.submitted_by = qa.id
`

function buildFileName(): string {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-')
  return `QTIP_DisputeResolution_${dateStr}_${timeStr}.xlsx`
}

function formatStatus(value: string | null): string {
  if (!value) return ''
  return value.charAt(0) + value.slice(1).toLowerCase()
}

function formatDate(value: Date | string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('en-US') : ''
}

export async function exportManagerTeamDisputes(
  params: ExportDisputesParams,
): Promise<DisputeExportResult> {
  const where = await buildDisputeWhere(
    { userId: params.userId, userRole: params.userRole },
    params.filters,
  )

  if (!where.hasScope) {
    // Legacy contract: surface this as a 200 with a `success: false` envelope
    // rather than letting the controller produce a generic error.
    throw new ManagerServiceError(
      'No departments assigned to this manager',
      200,
      'NO_DEPARTMENTS',
    )
  }

  const disputes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `${SELECT_EXPORT}
     WHERE ${where.whereSql}
     ORDER BY d.created_at DESC`,
    ...where.params,
  )

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Dispute Resolution')

  worksheet.columns = [
    { header: 'Dispute ID', key: 'dispute_id', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'CSR Name', key: 'csr_name', width: 24 },
    { header: 'Review ID', key: 'submission_id', width: 14 },
    { header: 'Form ID', key: 'form_id', width: 12 },
    { header: 'Form Name', key: 'form_name', width: 32 },
    { header: 'Current Score', key: 'total_score', width: 14 },
    { header: 'Previous Score', key: 'previous_score', width: 14 },
    { header: 'Date', key: 'created_at', width: 14 },
    { header: 'Resolved Date', key: 'resolved_at', width: 16 },
    { header: 'QA Analyst', key: 'qa_analyst_name', width: 22 },
    { header: 'Reason', key: 'reason', width: 48 },
    { header: 'Resolution Notes', key: 'resolution_notes', width: 48 },
  ]

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00AEEF' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 22

  for (const dispute of disputes) {
    worksheet.addRow({
      dispute_id: `#${dispute.dispute_id}`,
      status: formatStatus(dispute.status as string),
      csr_name: dispute.csr_name || '',
      submission_id: `#${dispute.submission_id}`,
      form_id: dispute.form_id,
      form_name: dispute.form_name || '',
      total_score: dispute.total_score != null ? `${dispute.total_score}%` : '',
      previous_score: dispute.previous_score != null ? `${dispute.previous_score}%` : '',
      created_at: formatDate(dispute.created_at as Date | string | null),
      resolved_at: formatDate(dispute.resolved_at as Date | string | null),
      qa_analyst_name: dispute.qa_analyst_name || '',
      reason: dispute.reason || '',
      resolution_notes: dispute.resolution_notes || '',
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
