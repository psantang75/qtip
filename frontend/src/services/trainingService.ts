import { api } from './authService'
import { normalizePaginated, PaginatedResult } from './qaService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoachingPurpose =
  | 'WEEKLY'
  | 'PERFORMANCE'
  | 'ONBOARDING'

export type CoachingFormat =
  | 'ONE_ON_ONE'
  | 'SIDE_BY_SIDE'
  | 'TEAM_SESSION'

export type CoachingSourceType =
  | 'QA_AUDIT'
  | 'MANAGER_OBSERVATION'
  | 'TREND'
  | 'DISPUTE'
  | 'SCHEDULED'
  | 'OTHER'

// Mirrors backend Prisma enum CoachingSessionStatus (backend/prisma/schema.prisma).
// Keep these in lock-step with `COACHING_STATUS_LABELS` in `@/constants/labels`
// and the SQL whitelist in `coaching.controller.setSessionStatus`.
export type CoachingStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'IN_PROCESS'
  | 'AWAITING_CSR_ACTION'
  | 'QUIZ_PENDING'
  | 'COMPLETED'
  | 'FOLLOW_UP_REQUIRED'
  | 'CLOSED'
  | 'CANCELED'

export interface QuizQuestion {
  id: number
  question_text: string
  options: string[]
  correct_option: number
}

export interface QuizAttemptSummary {
  id: number
  quiz_id?: number
  score: number
  passed: boolean
  attempt_number: number
  submitted_at: string
}

export interface QuizAttemptResult {
  score: number
  passed: boolean
  pass_score: number
  attempt_number: number
  correct_answers: number[]
}

export interface RecentSession {
  id: number
  session_date: string
  coaching_purpose: CoachingPurpose
  coaching_format: CoachingFormat
  topics: string[]
  status: CoachingStatus
}

export interface CoachingSession {
  id: number
  batch_id?: string
  csr_id: number
  csr_name: string
  created_by: number
  created_by_name: string
  coaching_purpose: CoachingPurpose
  coaching_format: CoachingFormat
  source_type: CoachingSourceType
  qa_audit_id?: number
  notes?: string
  required_action?: string
  kb_url?: string
  follow_up_notes?: string
  internal_notes?: string
  behavior_flags?: string           // legacy VARCHAR (kept for backward compat display)
  behavior_flag_ids?: number[]      // IDs from list_items (new)
  behavior_flag_items?: { id: number; category?: string; label: string; sort_order: number }[]
  root_cause_ids?: number[]
  root_cause_items?: { id: number; category?: string; label: string; sort_order: number }[]
  support_needed_ids?: number[]
  support_needed_items?: { id: number; category?: string; label: string; sort_order: number }[]
  kb_resources?: { id: number; title: string; resource_type?: string; url?: string; file_name?: string; description?: string }[]
  quizzes?: { id: number; quiz_title: string; pass_score: number; questions: QuizQuestion[] }[]
  require_acknowledgment: boolean
  require_action_plan: boolean
  due_date?: string
  follow_up_required: boolean
  follow_up_date?: string
  status: CoachingStatus
  delivered_at?: string
  completed_at?: string
  closed_at?: string
  csr_action_plan?: string
  csr_root_cause?: string
  csr_support_needed?: string
  csr_acknowledged_at?: string
  attachment_filename?: string
  topics: string[]
  topic_ids: number[]
  session_date: string
  created_at: string
  is_overdue?: boolean
  recent_sessions?: RecentSession[]
  prior_year_sessions?: RecentSession[]
  repeat_topics?: string[]
  quiz_attempts?: QuizAttemptSummary[]
  quiz_count?: number
  quiz_passed_count?: number
}

export type ResourceType = 'URL' | 'PDF' | 'IMAGE' | 'WORD' | 'POWERPOINT' | 'EXCEL' | 'VIDEO' | 'FILE'

export interface TrainingResource {
  id: number
  title: string
  resource_type: ResourceType
  url?: string
  file_name?: string
  file_size?: number
  file_mime_type?: string
  description?: string
  topic_ids: number[]
  topic_names: string[]
  is_active: boolean
  created_by: number
  created_at: string
}

export interface LibraryQuiz {
  id: number
  quiz_title: string
  pass_score: number
  is_active: boolean
  topic_id?: number
  topic_name?: string
  topic_ids: number[]
  topic_names: string[]
  question_count: number
  times_used: number
}

export interface CoachingStats {
  sessionsThisMonth: number
  awaitingCsrAction: number
  overdueSessions: number
  quizPassRate: number
  completionRate: number
}

export interface CSRHistoryResponse {
  sessions: RecentSession[]
  prior_year_sessions: RecentSession[]
  repeat_topics: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a raw backend paginated coaching response into PaginatedResult<CoachingSession> */
function normalizeCoachingPage(raw: any): PaginatedResult<CoachingSession> {
  const sessions: CoachingSession[] = raw?.data?.sessions ?? raw?.sessions ?? []
  const totalCount = raw?.data?.totalCount ?? raw?.totalCount ?? sessions.length
  const page       = raw?.data?.page  ?? raw?.page  ?? 1
  const limit      = raw?.data?.limit ?? raw?.limit ?? sessions.length
  return {
    items:      sessions,
    total:      Number(totalCount),
    page:       Number(page),
    limit:      Number(limit),
    totalPages: limit > 0 ? Math.ceil(Number(totalCount) / Number(limit)) : 1,
  }
}

// ── Coaching Sessions (trainer / manager / admin) ──────────────────────────────

export const trainingService = {

  async getCoachingSessions(params?: Record<string, any>): Promise<PaginatedResult<CoachingSession>> {
    const { data } = await api.get('/trainer/coaching-sessions', { params })
    return normalizeCoachingPage(data)
  },

  async getCoachingSessionDetail(id: number): Promise<CoachingSession> {
    const { data } = await api.get(`/trainer/coaching-sessions/${id}`)
    return data?.data ?? data
  },

  async createCoachingSession(formData: FormData): Promise<{ id?: number; ids?: number[]; batch_id?: string; count?: number }> {
    const { data } = await api.post('/trainer/coaching-sessions', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data?.data ?? data
  },

  async updateCoachingSession(id: number, formData: FormData): Promise<CoachingSession> {
    const { data } = await api.put(`/trainer/coaching-sessions/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data?.data ?? data
  },

  async setSessionStatus(id: number, status: string): Promise<void> {
    await api.patch(`/trainer/coaching-sessions/${id}/status`, { status })
  },

  async deliverSession(id: number): Promise<void> {
    await api.patch(`/trainer/coaching-sessions/${id}/deliver`)
  },

  async completeSession(id: number): Promise<void> {
    await api.patch(`/trainer/coaching-sessions/${id}/complete`)
  },

  async flagFollowUp(id: number, follow_up_date?: string): Promise<void> {
    await api.patch(`/trainer/coaching-sessions/${id}/flag-followup`, { follow_up_date })
  },

  async closeSession(id: number): Promise<void> {
    await api.patch(`/trainer/coaching-sessions/${id}/close`)
  },

  async downloadAttachment(id: number): Promise<Blob> {
    const { data } = await api.get(`/trainer/coaching-sessions/${id}/attachment`, {
      responseType: 'blob',
    })
    return data
  },

  async getCSRHistory(csrId: number): Promise<CSRHistoryResponse> {
    const { data } = await api.get(`/trainer/csr-coaching-history/${csrId}`)
    return data?.data ?? data
  },

  // ── CSR ────────────────────────────────────────────────────────────────────

  async getMyCoachingSessions(params?: Record<string, any>): Promise<PaginatedResult<CoachingSession>> {
    const { data } = await api.get('/csr/coaching-sessions', { params })
    return normalizeCoachingPage(data)
  },

  async getMyCoachingDetail(id: number): Promise<CoachingSession> {
    const { data } = await api.get(`/csr/coaching-sessions/${id}`)
    return data?.data ?? data
  },

  async submitCSRResponse(
    id: number,
    payload: { action_plan: string; root_cause?: string; support_needed?: string; acknowledged: boolean },
  ): Promise<void> {
    await api.post(`/csr/coaching-sessions/${id}/respond`, payload)
  },

  // ── Quiz ──────────────────────────────────────────────────────────────────

  async submitQuizAttempt(
    quizId: number,
    payload: { coaching_session_id?: number; answers: { question_id: number; selected_option: number }[] },
  ): Promise<QuizAttemptResult> {
    const { data } = await api.post(`/quizzes/${quizId}/attempt`, payload)
    return data?.data ?? data
  },

  async getMyAttempts(quizId: number, sessionId?: number): Promise<QuizAttemptSummary[]> {
    const { data } = await api.get(`/quizzes/${quizId}/attempts`, {
      params: sessionId ? { coaching_session_id: sessionId } : undefined,
    })
    return data?.data ?? data ?? []
  },

  // ── Resources ─────────────────────────────────────────────────────────────

  async getResources(params?: Record<string, any>): Promise<PaginatedResult<TrainingResource>> {
    const { data } = await api.get('/trainer/resources', { params })
    // Backend: { success: true, data: { resources: [...], totalCount, page, limit } }
    const inner = data?.data ?? data
    const items: TrainingResource[] = Array.isArray(inner?.resources)
      ? inner.resources
      : Array.isArray(inner) ? inner : []
    return {
      items,
      total:      Number(inner?.totalCount ?? items.length),
      page:       Number(inner?.page       ?? 1),
      limit:      Number(inner?.limit      ?? items.length),
      totalPages: inner?.limit > 0
        ? Math.ceil(Number(inner?.totalCount ?? items.length) / Number(inner.limit))
        : 1,
    }
  },

  async createResource(payload: Partial<TrainingResource> & { file?: File }): Promise<TrainingResource> {
    const fd = new FormData()
    Object.entries(payload).forEach(([k, v]) => {
      if (k === 'file') return
      if (k === 'topic_ids') { fd.append('topic_ids', JSON.stringify(v)); return }
      if (k === 'topic_names') return
      if (v !== undefined) fd.append(k, String(v))
    })
    if (payload.file) fd.append('file', payload.file)
    const { data } = await api.post('/trainer/resources', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data?.data ?? data
  },

  async updateResource(id: number, payload: Partial<TrainingResource> & { file?: File }): Promise<TrainingResource> {
    const fd = new FormData()
    Object.entries(payload).forEach(([k, v]) => {
      if (k === 'file') return
      if (k === 'topic_ids') { fd.append('topic_ids', JSON.stringify(v)); return }
      if (k === 'topic_names') return
      if (v !== undefined) fd.append(k, String(v))
    })
    if (payload.file) fd.append('file', payload.file)
    const { data } = await api.put(`/trainer/resources/${id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data?.data ?? data
  },

  async toggleResourceStatus(id: number, is_active: boolean): Promise<void> {
    await api.patch(`/trainer/resources/${id}/status`, { is_active })
  },

  getResourceFileUrl(id: number): string {
    return `/api/trainer/resources/${id}/file`
  },

  async downloadResourceFile(id: number): Promise<Blob> {
    const { data } = await api.get(`/trainer/resources/${id}/file`, { responseType: 'blob' })
    return data
  },

  async getResourceViewUrl(id: number): Promise<string> {
    const { data } = await api.get(`/trainer/resources/${id}/view-token`)
    return (data?.data ?? data).viewUrl as string
  },

  // ── Quiz Library ──────────────────────────────────────────────────────────

  async getQuizLibrary(params?: Record<string, any>): Promise<PaginatedResult<LibraryQuiz>> {
    const { data } = await api.get('/trainer/quiz-library', { params })
    const items: LibraryQuiz[] = Array.isArray(data?.data) ? data.data : (data?.items ?? [])
    // Backend now returns `{ data, pagination }`. Surface the real
    // pagination envelope so callers (and the truncation indicator) reflect
    // server-side totals instead of a synthetic single-page wrapper.
    const p = data?.pagination
    return {
      items,
      total:      typeof p?.total      === 'number' ? p.total      : items.length,
      page:       typeof p?.page       === 'number' ? p.page       : 1,
      limit:      typeof p?.limit      === 'number' ? p.limit      : items.length,
      totalPages: typeof p?.totalPages === 'number' ? p.totalPages : 1,
    }
  },

  async getLibraryQuizDetail(id: number): Promise<LibraryQuiz & { questions: QuizQuestion[] }> {
    const { data } = await api.get(`/trainer/quiz-library/${id}`)
    return data?.data ?? data
  },

  async createLibraryQuiz(
    payload: { quiz_title: string; pass_score: number; is_active?: boolean; topic_id?: number; topic_ids?: number[]; course_id?: number; questions: Omit<QuizQuestion, 'id'>[] },
  ): Promise<LibraryQuiz> {
    const { data } = await api.post('/trainer/quiz-library', payload)
    return data?.data ?? data
  },

  async updateLibraryQuiz(
    id: number,
    payload: { quiz_title?: string; pass_score?: number; topic_id?: number; topic_ids?: number[]; questions?: Omit<QuizQuestion, 'id'>[] },
  ): Promise<LibraryQuiz> {
    const { data } = await api.put(`/trainer/quiz-library/${id}`, payload)
    return data?.data ?? data
  },

  async toggleQuizStatus(id: number): Promise<void> {
    await api.patch(`/trainer/quiz-library/${id}/status`)
  },

  async deleteLibraryQuiz(id: number): Promise<void> {
    await api.delete(`/trainer/quiz-library/${id}`)
  },

  // ── Team CSRs ─────────────────────────────────────────────────────────────

  async getCoaches(): Promise<Array<{ id: number; name: string }>> {
    const { data } = await api.get('/trainer/coaches')
    return data?.data ?? []
  },

  async getTeamCSRs(): Promise<Array<{ id: number; name: string; email: string; department: string }>> {
    const { data } = await api.get('/trainer/team-csrs')
    return data?.data ?? []
  },

  // ── Stats / Reports ────────────────────────────────────────────────────────

  async getReportsSummary(params?: Record<string, any>): Promise<any> {
    const { data } = await api.get('/trainer/reports/summary', { params })
    return data?.data ?? data
  },

  async getCSRCoachingList(params?: Record<string, any>): Promise<PaginatedResult<any>> {
    const { data } = await api.get('/trainer/reports/csr-list', { params })
    // Backend: { success: true, data: { csrs: [...], totalCount, page, limit } }
    const inner = data?.data ?? data
    const items: any[] = Array.isArray(inner?.csrs) ? inner.csrs : (Array.isArray(inner) ? inner : [])
    return {
      items,
      total:      Number(inner?.totalCount ?? items.length),
      page:       Number(inner?.page       ?? 1),
      limit:      Number(inner?.limit      ?? items.length),
      totalPages: inner?.limit > 0
        ? Math.ceil(Number(inner?.totalCount ?? items.length) / Number(inner.limit))
        : 1,
    }
  },
}

export default trainingService
