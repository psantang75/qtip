import { api } from './authService'

// ── Score helpers ─────────────────────────────────────────────────────────────

export function scoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-600'
  if (score >= 70) return 'text-amber-600'
  return 'text-red-600'
}

// ── Pagination helpers ────────────────────────────────────────────────────────

/**
 * Standard paginated response shape used throughout the app.
 * Backend endpoints may return different field names; use normalizePaginated
 * to coerce them into this shape before returning from service functions.
 */
export interface PaginatedResult<T> {
  items:      T[]
  total:      number
  page:       number
  limit:      number
  totalPages: number
}

/**
 * Normalizes any backend paginated response into PaginatedResult<T>.
 * Handles the three shapes currently in use:
 *   { data, pagination: { total, page, limit, totalPages } }  — QA list
 *   { data, total, page, perPage, totalPages }                 — CSR
 *   { disputes, total, page, limit, totalPages }               — Manager disputes
 */
export function normalizePaginated<T>(
  raw: any,
  itemKey: string = 'data',
  mapItem?: (item: any) => T,
): PaginatedResult<T> {
  const items: any[] = raw?.[itemKey] ?? raw?.data ?? raw?.items ?? (Array.isArray(raw) ? raw : [])
  const pagination   = raw?.pagination ?? raw
  return {
    items:      mapItem ? items.map(mapItem) : (items as T[]),
    total:      Number(pagination?.total      ?? items.length),
    page:       Number(pagination?.page       ?? 1),
    limit:      Number(pagination?.limit ?? pagination?.perPage ?? items.length),
    totalPages: Number(pagination?.totalPages ?? 1),
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CSRActivityRow {
  csr_id: number
  csr_name: string
  department_name: string
  total_reviews: number
  avg_score: number
  disputes: number
  last_audit_date?: string
}

interface RawManagerActivityRow {
  id?: number
  csr_id?: number
  csr_name?: string
  name?: string
  department_name?: string
  department?: string
  audits_week?: number
  audits_month?: number
  audits?: number
  avg_score?: number
  disputes_week?: number
  disputes_month?: number
  disputes?: number
  [key: string]: unknown
}

export interface Submission {
  id: number
  call_id?: number
  form_id?: number
  csr_name: string
  csr_id?: number
  department_name: string
  form_name: string
  score: number
  status: string
  created_at: string
  reviewer_name?: string
  has_dispute?: boolean
  dispute_status?: string
  interaction_date?: string | null
}

export interface AnswerRow {
  question_text: string
  answer: string
  score?: number
  category_name?: string
  weight?: number
}

export interface DisputeRecord {
  id: number
  submission_id: number
  reason: string
  // status IS the resolution: OPEN = pending, UPHELD = score kept, ADJUSTED = score changed
  status: 'OPEN' | 'UPHELD' | 'ADJUSTED'
  resolution_notes?: string
  new_score?: number
  previous_score?: number | null
  adjusted_score?: number | null
  created_at: string
  resolved_at?: string
  resolved_by?: number | null
  attachment_url?: string | null
  csr_name?: string
  form_name?: string
  original_score?: number
  qa_analyst_name?: string
  interaction_date?: string | null
}

export interface MetadataEntry {
  field_name: string
  value: string
}

export interface SubmissionDetail extends Submission {
  answers: AnswerRow[]
  metadata: Record<string, string> | MetadataEntry[]
  dispute?: DisputeRecord
}

export interface FormQuestion {
  id?: number
  question_text: string
  question_type: 'YES_NO' | 'TEXT' | 'SCALE'
  is_required: boolean
  order_index: number
}

export interface FormCategory {
  id?: number
  category_name: string
  weight: number
  questions: FormQuestion[]
}

export interface FormSummary {
  id: number
  form_name: string
  interaction_type?: string
  is_active: boolean
  version?: number
  created_at: string
  category_count?: number
  question_count?: number
}

export interface FormDetail extends FormSummary {
  categories: FormCategory[]
}

export interface AnalyticsResult {
  labels: string[]
  datasets: { name: string; data: number[] }[]
  summary?: Record<string, number>
}

// ── Dispute history item (from /csr/disputes/history) ────────────────────────
export interface DisputeHistoryItem {
  dispute_id: number
  audit_id:   number
  form_name:  string
  score:      number
  previous_score: number | null
  adjusted_score: number | null
  status:     string
  created_at: string
  resolution_notes: string | null
}

// ── Field-name normalizer ─────────────────────────────────────────────────────
// Backends use varying field names. Normalize everything to the Submission interface.
// QA/Admin list:   total_score, submitted_at, auditor_name, form_name (root)
// CSR list:        score (number), submittedDate, formName (root)
// CSR detail:      score, submittedDate, form.form_name, form.categories (nested)
function normalizeSubmission(item: any): any {
  if (!item || typeof item !== 'object') return item
  const rawScore = item.score ?? item.total_score ?? 0
  // For CSR detail, form data lives inside item.form
  const nestedForm = item.form && typeof item.form === 'object' ? item.form : null
  return {
    ...item,
    score:         typeof rawScore === 'string' ? parseFloat(rawScore) || 0 : Number(rawScore) || 0,
    form_name:     item.form_name     ?? item.formName ?? nestedForm?.form_name ?? '',
    created_at:    item.created_at    ?? item.submitted_at ?? item.submittedDate ?? '',
    reviewer_name: item.reviewer_name ?? item.auditor_name ?? item.qa_analyst_name ?? undefined,
    // CSR detail already includes full form structure — expose as formData so the
    // detail page can use it directly without a separate /forms/:id fetch
    formData:      item.formData ?? (nestedForm?.categories ? nestedForm : undefined),
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

const qaService = {

  // ── Dashboard ──────────────────────────────────────────────────────────────
  getManagerStats:      () => api.get('/manager/dashboard-stats').then(r => r.data),
  getManagerCsrActivity:(period: 'week' | 'month' = 'week') =>
    api.get(`/manager/csr-activity?period=${period}`).then(r => {
      // Backend returns {id, name, department, audits_week, audits_month, disputes_week, ...}
      // Normalize to CSRActivityRow shape and apply period filter client-side
      return (r.data as RawManagerActivityRow[]).map((row): CSRActivityRow & { _raw: RawManagerActivityRow } => ({
        _raw: row,
        csr_id:          row.id ?? row.csr_id ?? 0,
        csr_name:        row.csr_name ?? row.name ?? '',
        department_name: row.department_name ?? row.department ?? '',
        total_reviews:   period === 'week' ? Number(row.audits_week ?? 0)
                       : period === 'month' ? Number(row.audits_month ?? 0)
                       : Number(row.audits ?? 0),
        avg_score:       Number(row.avg_score ?? 0),
        disputes:        period === 'week' ? Number(row.disputes_week ?? 0)
                       : period === 'month' ? Number(row.disputes_month ?? 0)
                       : Number(row.disputes ?? 0),
        last_audit_date: row.last_audit_date,
      }))
    }),
  getCSRStats:          () => api.get('/csr/dashboard-stats').then(r => r.data),

  // ── Submissions ────────────────────────────────────────────────────────────
  getSubmissions: (params: {
    page?: number; limit?: number; search?: string
    status?: string; form_id?: number; department_id?: number
    date_start?: string; date_end?: string
  }) => {
    const q = new URLSearchParams()
    if (params.page)          q.set('page', String(params.page))
    if (params.limit)         q.set('limit', String(params.limit))
    if (params.search)        q.set('search', params.search)
    if (params.status)        q.set('status', params.status)
    if (params.form_id)       q.set('form_id', String(params.form_id))
    if (params.department_id) q.set('department_id', String(params.department_id))
    if (params.date_start)    q.set('date_start', params.date_start)
    if (params.date_end)      q.set('date_end', params.date_end)
    return api.get(`/qa/completed?${q}`).then(r => {
      const d = r.data
      const raw = d?.items ?? d?.data ?? []
      return {
        items: raw.map(normalizeSubmission),
        total: d?.total ?? d?.totalItems ?? d?.pagination?.total ?? 0,
        page:  d?.page ?? d?.currentPage ?? d?.pagination?.page ?? 1,
        totalPages: d?.totalPages ?? d?.pagination?.totalPages ?? 1,
      } as PaginatedResult<Submission>
    })
  },

  getSubmissionDetail: (id: number) =>
    api.get(`/qa/completed/${id}`).then(r => normalizeSubmission(r.data) as SubmissionDetail),

  getTeamAudits: (params: {
    page?: number; limit?: number; search?: string
    status?: string; form_id?: number; csr_id?: number
    start_date?: string; end_date?: string
  }) => {
    const q = new URLSearchParams()
    if (params.page)       q.set('page', String(params.page))
    if (params.limit)      q.set('limit', String(params.limit))
    if (params.search)     q.set('search', params.search)
    if (params.status)     q.set('status', params.status)
    if (params.form_id)    q.set('form_id', String(params.form_id))
    if (params.csr_id)     q.set('csr_id', String(params.csr_id))
    if (params.start_date) q.set('start_date', params.start_date)
    if (params.end_date)   q.set('end_date', params.end_date)
    return api.get(`/manager/team-audits?${q}`).then(r => {
      const d = r.data
      // Manager team-audits endpoint returns { audits: [...], totalCount: N }
      const raw = d?.audits ?? d?.items ?? d?.data ?? []
      const total = d?.totalCount ?? d?.total ?? d?.totalItems ?? d?.pagination?.total ?? 0
      const limit = params.limit ?? 20
      return {
        items: raw.map(normalizeSubmission),
        total,
        page:       d?.page ?? d?.currentPage ?? d?.pagination?.page ?? 1,
        totalPages: (d?.totalPages ?? d?.pagination?.totalPages ?? Math.ceil(total / limit)) || 1,
      } as PaginatedResult<Submission>
    })
  },

  getTeamAuditDetail: (id: number) =>
    api.get(`/manager/team-audits/${id}`).then(r => normalizeSubmission(r.data) as SubmissionDetail),

  getCSRAudits: (params: { page?: number; limit?: number; status?: string; start_date?: string; end_date?: string; search?: string }) => {
    const q = new URLSearchParams()
    if (params.page)       q.set('page', String(params.page))
    if (params.limit)      q.set('limit', String(params.limit))
    if (params.status)     q.set('status', params.status)
    if (params.search)     q.set('search', params.search)
    if (params.start_date) q.set('startDate', params.start_date)
    if (params.end_date)   q.set('endDate', params.end_date)
    return api.get(`/csr/audits?${q}`).then(r => {
      const d = r.data
      // CSR endpoint returns { audits: [...], totalCount: N }
      const raw = d?.audits ?? d?.items ?? d?.data ?? []
      const total = d?.totalCount ?? d?.total ?? d?.totalItems ?? d?.pagination?.total ?? 0
      const limit = params.limit ?? 20
      return {
        items: raw.map(normalizeSubmission),
        total,
        page:       d?.page ?? d?.currentPage ?? d?.pagination?.page ?? 1,
        totalPages: d?.totalPages ?? d?.pagination?.totalPages ?? Math.ceil(total / limit) ?? 1,
      } as PaginatedResult<Submission>
    })
  },

  getCSRAuditDetail: (id: number) =>
    api.get(`/csr/audits/${id}`).then(r => normalizeSubmission(r.data) as SubmissionDetail),

  // ── Disputes ───────────────────────────────────────────────────────────────
  getManagerDisputes: (params: {
    page?: number; limit?: number; status?: string
    csr_id?: number; startDate?: string; endDate?: string
  }) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) q.set(k, String(v))
    })
    return api.get(`/manager/disputes?${q}`).then(r => {
      const d = r.data
      const toNum = (v: any) => v == null ? null : (typeof v === 'string' ? parseFloat(v) || 0 : Number(v))
      // Manager disputes endpoint returns { disputes: [...], total, page, limit, totalPages }
      const raw: any[] = d?.disputes ?? d?.items ?? d?.data ?? []
      return {
        items: raw.map((item: any) => ({
          ...item,
          // Normalize field names: manager returns dispute_id, submission_id, total_score, etc.
          id:             item.id             ?? item.dispute_id,
          submission_id:  item.submission_id,
          csr_name:       item.csr_name,
          form_name:      item.form_name,
          original_score: toNum(item.previous_score ?? item.original_score ?? item.total_score),
          previous_score: toNum(item.previous_score),
          adjusted_score: toNum(item.adjusted_score),
          status:         item.status,
          reason:         item.reason,
          created_at:     item.created_at,
          resolved_at:    item.resolved_at,
          resolution_notes:   item.resolution_notes,
          resolution_action:  item.resolution_action,
          qa_analyst_name:    item.qa_analyst_name,
        })) as DisputeRecord[],
        total:      d?.total ?? raw.length,
        page:       d?.page  ?? 1,
        totalPages: d?.totalPages ?? 1,
      } as PaginatedResult<DisputeRecord>
    })
  },

  getManagerDisputeDetail: (id: number) =>
    api.get(`/manager/disputes/${id}`).then(r => r.data as DisputeRecord),

  resolveDispute: (disputeId: number, payload: {
    resolution_action: 'UPHOLD' | 'ADJUST' | 'ASSIGN_TRAINING'
    resolution_notes: string
    new_score?: number
    answers?: { question_id: number; answer: string; notes?: string }[]
  }) => api.post(`/manager/disputes/${disputeId}/resolve`, payload).then(r => r.data),

  getCSRDisputeHistory: (params?: { page?: number; limit?: number; status?: string }) =>
    api.get('/csr/disputes/history', { params }).then(r => {
      const d = r.data
      const raw: any[] = d?.data ?? d?.items ?? (Array.isArray(d) ? d : [])
      const toNum = (v: any) => v == null ? null : (typeof v === 'string' ? parseFloat(v) || 0 : Number(v))
      return {
        items: raw.map((item: any) => ({
          ...item,
          score:          toNum(item.score) ?? 0,
          previous_score: toNum(item.previous_score),
          adjusted_score: toNum(item.adjusted_score),
        })) as DisputeHistoryItem[],
        total:      d?.total ?? raw.length,
        page:       d?.page ?? 1,
        totalPages: d?.totalPages ?? 1,
      }
    }),

  submitCSRDispute: (payload: { submission_id: number; reason: string }) =>
    api.post('/disputes', payload).then(r => r.data),

  updateCSRDispute: (disputeId: number, reason: string, attachment?: File | null) => {
    const formData = new FormData()
    formData.append('reason', reason)
    if (attachment) formData.append('attachment', attachment)
    return api.put(`/disputes/${disputeId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data)
  },

  downloadDisputeAttachment: (disputeId: number, filename: string) =>
    api.get(`/disputes/${disputeId}/attachment`, { responseType: 'blob' }).then(r => {
      const url = window.URL.createObjectURL(r.data)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    }),

  finalizeCSRReview: (submissionId: number) =>
    api.put(`/csr/audits/${submissionId}/finalize`, { acknowledged: true }).then(r => r.data),

  // ── Forms ──────────────────────────────────────────────────────────────────
  getForms: (params?: { is_active?: boolean; page?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.is_active !== undefined) q.set('is_active', String(params.is_active))
    if (params?.page)  q.set('page', String(params.page))
    if (params?.limit) q.set('limit', String(params.limit))
    return api.get(`/forms?${q}`).then(r => {
      const d = r.data
      if (Array.isArray(d)) return d as FormSummary[]
      if (Array.isArray(d?.forms)) return d.forms as FormSummary[]
      if (Array.isArray(d?.items)) return d.items as FormSummary[]
      return [] as FormSummary[]
    })
  },

  getFormDetail: (id: number) =>
    api.get(`/forms/${id}`).then(r => r.data as FormDetail),

  createForm: (payload: Partial<FormDetail>) =>
    api.post('/forms', payload).then(r => r.data as FormDetail),

  updateForm: (id: number, payload: Partial<FormDetail>) =>
    api.put(`/forms/${id}`, payload).then(r => r.data as FormDetail),

  deactivateForm: (id: number) =>
    api.delete(`/forms/${id}`).then(r => r.data),

  // ── Analytics ──────────────────────────────────────────────────────────────
  getAnalyticsFilters: () =>
    api.get('/analytics/filters').then(r => r.data as {
      departments: { id: number; name: string }[]
      csrs: { id: number; name: string }[]
      forms: { id: number; name: string }[]
    }),

  getComprehensiveReport: (payload: {
    report_type: 'trends' | 'averages' | 'raw_scores' | 'summary'
    start_date: string
    end_date: string
    department_id?: number
    csr_id?: number
    form_id?: number
    group_by?: 'csr' | 'department' | 'form'
    aggregation?: 'daily' | 'weekly' | 'monthly'
  }) => api.post('/analytics/comprehensive-report', payload).then(r => r.data as AnalyticsResult),

  getTeamCSRs: () =>
    api.get('/manager/team-csrs').then(r => r.data as { id: number; name: string }[]),

  getFormsForFilter: () =>
    api.get('/forms?is_active=true&limit=200').then(r => {
      const d = r.data
      if (Array.isArray(d)) return d as FormSummary[]
      if (Array.isArray(d?.items)) return d.items as FormSummary[]
      if (Array.isArray(d?.forms)) return d.forms as FormSummary[]
      return [] as FormSummary[]
    }),
}

export default qaService
