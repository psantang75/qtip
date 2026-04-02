import { api } from './authService'
import { normalizePaginated, type PaginatedResult } from './qaService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type WriteUpType   = 'VERBAL_WARNING' | 'WRITTEN_WARNING' | 'FINAL_WARNING'
export type WriteUpStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'DELIVERED'
  | 'AWAITING_SIGNATURE'
  | 'SIGNED'
  | 'FOLLOW_UP_PENDING'
  | 'CLOSED'
export type WriteUpExampleSource = 'MANUAL' | 'QA_IMPORT' | 'COACHING_IMPORT'

export interface WriteUpExample {
  id: number
  violation_id: number
  example_date?: string | null
  description: string
  source: WriteUpExampleSource
  qa_submission_id?: number | null
  qa_question_id?: number | null
  sort_order: number
}

export interface WriteUpViolation {
  id: number
  incident_id: number
  policy_violated: string
  reference_material?: string | null
  sort_order: number
  examples: WriteUpExample[]
}

export interface WriteUpIncident {
  id: number
  write_up_id: number
  description: string
  sort_order: number
  violations: WriteUpViolation[]
}

export interface WriteUpAttachment {
  id: number
  attachment_type: string
  reference_type?: string | null
  reference_id?: number | null
  filename: string
  file_size?: number | null
  mime_type?: string | null
}

export interface WriteUp {
  id: number
  document_type: WriteUpType
  status: WriteUpStatus
  meeting_date?: string | null
  created_at: string
  csr_id: number
  csr_name: string
  created_by: number
  created_by_name: string
  incident_count: number
}

export interface WriteUpDetail extends WriteUp {
  meeting_notes?: string | null
  corrective_action?: string | null
  correction_timeline?: string | null
  checkin_date?: string | null
  consequence?: string | null
  linked_coaching_id?: number | null
  manager_id?: number | null
  manager_name?: string | null
  hr_witness_id?: number | null
  hr_witness_name?: string | null
  follow_up_required: boolean
  follow_up_date?: string | null
  follow_up_assigned_to?: number | null
  follow_up_assignee_name?: string | null
  follow_up_checklist?: string | null
  follow_up_notes?: string | null
  signed_at?: string | null
  acknowledged_at?: string | null
  delivered_at?: string | null
  closed_at?: string | null
  signature_data?: string | null
  incidents: WriteUpIncident[]
  prior_discipline: any[]
  attachments: WriteUpAttachment[]
}

export interface WriteUpListParams {
  csr_id?: number
  status?: string
  document_type?: string
  date_from?: string
  date_to?: string
  search?: string
  page?: number
  limit?: number
}

// ── Service ───────────────────────────────────────────────────────────────────

const writeupService = {

  getWriteUps: async (params: WriteUpListParams = {}): Promise<PaginatedResult<WriteUp>> => {
    const query = new URLSearchParams()
    if (params.csr_id)       query.set('csr_id',       String(params.csr_id))
    if (params.status)       query.set('status',        params.status)
    if (params.document_type) query.set('document_type', params.document_type)
    if (params.date_from)    query.set('date_from',     params.date_from)
    if (params.date_to)      query.set('date_to',       params.date_to)
    if (params.search)       query.set('search',        params.search)
    if (params.page)         query.set('page',          String(params.page))
    if (params.limit)        query.set('limit',         String(params.limit))
    const qs = query.toString()
    const res = await api.get(`/writeups${qs ? `?${qs}` : ''}`)
    const payload = res.data?.data ?? res.data
    return normalizePaginated<WriteUp>(payload, 'items')
  },

  getWriteUpById: async (id: number): Promise<WriteUpDetail> => {
    const res = await api.get(`/writeups/${id}`)
    return res.data.data ?? res.data
  },

  createWriteUp: async (body: Partial<WriteUpDetail>): Promise<{ id: number }> => {
    const res = await api.post('/writeups', body)
    return res.data.data ?? res.data
  },

  updateWriteUp: async (id: number, body: Partial<WriteUpDetail>): Promise<void> => {
    await api.put(`/writeups/${id}`, body)
  },

  transitionStatus: async (
    id: number,
    body: { status: WriteUpStatus; meeting_notes?: string; meeting_date?: string; follow_up_notes?: string },
  ): Promise<void> => {
    await api.patch(`/writeups/${id}/status`, body)
  },

  signWriteUp: async (id: number, body: { signature_data: string }): Promise<void> => {
    await api.post(`/writeups/${id}/sign`, body)
  },

  setFollowUp: async (
    id: number,
    body: { follow_up_date: string; follow_up_assigned_to: number; follow_up_checklist: string },
  ): Promise<void> => {
    await api.patch(`/writeups/${id}/follow-up`, body)
  },

  searchQaRecords: async (params: {
    csr_id: number
    form_id?: number
    date_from?: string
    date_to?: string
    question_text?: string
    question_filters?: Array<{ question_id: number; answer_value: string }>
    failed_only?: boolean
  }): Promise<any[]> => {
    const query = new URLSearchParams({ csr_id: String(params.csr_id) })
    if (params.form_id)       query.set('form_id',       String(params.form_id))
    if (params.date_from)     query.set('date_from',     params.date_from)
    if (params.date_to)       query.set('date_to',       params.date_to)
    if (params.question_text) query.set('question_text', params.question_text)
    if (params.failed_only !== undefined) query.set('failed_only', String(params.failed_only))
    // Append per-question OR filters as positionally matched arrays
    params.question_filters?.forEach(f => {
      query.append('question_id',   String(f.question_id))
      query.append('answer_value',  f.answer_value)
    })
    const res = await api.get(`/writeups/qa-search?${query.toString()}`)
    return res.data.data ?? res.data
  },

  searchCoachingSessions: async (params: {
    csr_id: number
    date_from?: string
    date_to?: string
    topic_names?: string[]
  }): Promise<any[]> => {
    const query = new URLSearchParams({ csr_id: String(params.csr_id) })
    if (params.date_from) query.set('date_from', params.date_from)
    if (params.date_to)   query.set('date_to',   params.date_to)
    params.topic_names?.forEach(n => query.append('topic_name', n))
    const res = await api.get(`/writeups/coaching-search?${query.toString()}`)
    return res.data.data ?? res.data
  },

  getPriorDiscipline: async (csrId: number): Promise<{ write_ups: any[]; coaching_sessions: any[] }> => {
    const res = await api.get(`/writeups/prior-discipline/${csrId}`)
    return res.data.data ?? res.data
  },

  createLinkedCoachingSession: async (params: {
    csr_id: number
    session_date: string
    coaching_purpose: string
    coaching_format: string
    source_type?: string
    topic_names?: string[]
    notes?: string
  }): Promise<{ id: number; label: string }> => {
    const res = await api.post('/writeups/coaching-session', params)
    return res.data.data ?? res.data
  },

  uploadAttachment: async (writeUpId: number, file: File): Promise<{ id: number }> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await api.post(`/writeups/${writeUpId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.data ?? res.data
  },

  deleteAttachment: async (writeUpId: number, attachmentId: number): Promise<void> => {
    await api.delete(`/writeups/${writeUpId}/attachments/${attachmentId}`)
  },

}

export default writeupService
