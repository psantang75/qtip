import { api } from './authService'

// ── Curated manual-upload registry ────────────────────────────────────────────
// SINGLE source of truth for which data types are uploadable in the admin
// Manual Upload area. Only entries listed here are offered; every other raw
// table (and all automated Insights Engine reports) is intentionally excluded.
// Adding a type here is a deliberate one-line change.
export interface ManualUploadType {
  code: string
  label: string
  description: string
  requiredColumns: string[]
}

export const MANUAL_UPLOAD_TYPES: ManualUploadType[] = [
  {
    code: 'punch_data',
    label: 'Paychex Punch Data',
    description: 'Time-clock punches exported from Paychex Flex (employee-time-cards). Matched to users by Alert Email; deduped by Post ID.',
    requiredColumns: ['Post ID', 'Alert Email', 'Actual Date/Time In', 'Regular Duration'],
  },
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportPreview {
  columns: string[]
  preview_rows: Record<string, unknown>[]
  total_rows: number
  email_match_summary: {
    checked: number
    matched: number
    unmatched: number
    unmatched_emails: string[]
  }
  column_check: {
    data_type: string
    required: string[]
    missing: string[]
    valid: boolean
  }
}

export interface ImportResult {
  import_log_id: number
  rows_total: number
  rows_imported: number
  rows_skipped: number
  rows_errored: number
  warnings: string[]
  message?: string
}

export interface ImportLogRow {
  id: number
  data_type: string
  file_name: string
  rows_imported: number
  rows_skipped: number
  rows_errored: number
  status: string
  created_at: string
  importer?: { id: number; username: string; email: string } | null
  error_details?: unknown
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function previewImport(file: File, dataType: string): Promise<ImportPreview> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('data_type', dataType)
  const { data } = await api.post('/imports/preview', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function uploadImport(file: File, dataType: string): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('data_type', dataType)
  const { data } = await api.post('/imports/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function getImportHistory(dataType: string): Promise<ImportLogRow[]> {
  const { data } = await api.get('/imports/history', {
    params: { data_type: dataType, limit: 50 },
  })
  return data?.data ?? []
}
