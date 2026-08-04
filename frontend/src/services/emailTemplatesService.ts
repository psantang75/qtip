import { api } from './authService'

export type EmailCadence = 'IMMEDIATE' | 'DAILY' | 'WEEKLY'
export type EmailDigestFilter = 'ALL' | 'BELOW_THRESHOLD' | 'ROUTED_TO_QA'
export type EmailSendStatus =
  | 'SENT' | 'FAILED'
  | 'SKIPPED_DISABLED' | 'SKIPPED_OFF' | 'SKIPPED_RATE_LIMIT'
  | 'SKIPPED_QUIET_HOURS' | 'SKIPPED_INACTIVE_USER'
  | 'SKIPPED_CIRCUIT_BREAKER' | 'SKIPPED_NOT_CONFIGURED'

export type RoleToken =
  | 'self' | 'agent' | 'direct_manager' | 'department_director'
  | 'creator' | 'original_qa' | 'qa_pool' | 'hr_witness'
  | 'assignee' | 'coach' | 'admins' | 'designated'

export interface EmailTemplate {
  id: number
  template_key: string
  category: string
  name: string
  description: string | null
  subject: string
  body_html: string
  body_text: string | null
  cadence: EmailCadence
  digest_filter: EmailDigestFilter
  is_enabled: boolean
  is_locked: boolean
  allowed_variables: string[]
  available_roles: RoleToken[]
  recipient_roles: RoleToken[]
  recipient_summary: string
  version: number
  updated_by: number | null
  updated_at: string
  created_at: string
  // Spec-driven, decoration-only fields the backend includes for the UI.
  role_labels?: Record<RoleToken, string>
  fixed_roles?: RoleToken[]
  digest_eligible?: boolean
  /** Human description of where {{deepLinkPath}} routes for this template. */
  deep_link_target?: string | null
}

export interface EmailTemplateVersion {
  id: number
  template_id: number
  version: number
  subject: string
  body_html: string
  body_text: string | null
  cadence: EmailCadence
  digest_filter: EmailDigestFilter
  is_enabled: boolean
  edited_by: number | null
  edited_at: string
  editor?: { id: number; username: string } | null
}

export interface EmailLogRow {
  id: number
  template_key: string
  to_email: string
  to_user_id: number | null
  subject: string
  status: EmailSendStatus
  error_message: string | null
  message_id: string | null
  related_entity_type: string | null
  related_entity_id: number | null
  sent_at: string | null
  created_at: string
  to_user?: { id: number; username: string } | null
}

/** A notification waiting for the digest scheduler to mail it. */
export interface QueuedNotification {
  id: number
  user_id: number
  template_key: string
  payload: Record<string, unknown>
  scheduled_for: string
  dedupe_key: string
  created_at: string
  user?: { id: number; username: string; email: string | null; is_active: boolean } | null
  /** False means no template backs this key, so it can never send. */
  template_exists: boolean
  template_enabled: boolean | null
}

export interface EmailHealth {
  configured: boolean
  dryRun: boolean
  transport: { ok: boolean; error?: string }
  circuit: { tripped: boolean; count: number; trippedAt: number | null }
  last24h: Array<{ status: EmailSendStatus; _count: { _all: number } }>
}

const emailTemplatesService = {
  list: async (): Promise<EmailTemplate[]> =>
    (await api.get<{ templates: EmailTemplate[] }>('/admin/email-templates')).data.templates,
  get: async (id: number): Promise<{ template: EmailTemplate; versions: EmailTemplateVersion[] }> =>
    (await api.get(`/admin/email-templates/${id}`)).data,
  update: async (id: number, body: Partial<EmailTemplate>): Promise<EmailTemplate> =>
    (await api.put<{ template: EmailTemplate }>(`/admin/email-templates/${id}`, body)).data.template,
  preview: async (id: number, body: { subject?: string; body_html?: string; data?: Record<string, unknown> }) =>
    (await api.post<{ subject: string; html: string }>(`/admin/email-templates/${id}/preview`, body)).data,
  testSend: async (id: number, to: string) =>
    (await api.post<{ ok: boolean; messageId?: string; error?: string }>(`/admin/email-templates/${id}/test-send`, { to })).data,
  reset: async (id: number) =>
    (await api.post<{ template: EmailTemplate }>(`/admin/email-templates/${id}/reset`, {})).data.template,
  rollback: async (id: number, version_id: number) =>
    (await api.post<{ template: EmailTemplate }>(`/admin/email-templates/${id}/rollback`, { version_id })).data.template,
  health: async (): Promise<EmailHealth> =>
    (await api.get<EmailHealth>('/admin/email-templates/_health')).data,
  recentSends: async (params?: { limit?: number; status?: string; template_key?: string }): Promise<EmailLogRow[]> =>
    (await api.get<{ rows: EmailLogRow[] }>('/admin/email-templates/_recent-sends', { params })).data.rows,
  resend: async (logId: number) =>
    (await api.post<{ ok: boolean; messageId?: string; error?: string }>(`/admin/email-templates/_resend/${logId}`, {})).data,
  queue: async (params?: { limit?: number }): Promise<{ rows: QueuedNotification[]; total: number }> =>
    (await api.get<{ rows: QueuedNotification[]; total: number }>('/admin/email-templates/_queue', { params })).data,
  discardQueued: async (body: { ids?: number[]; template_key?: string }): Promise<number> =>
    (await api.post<{ discarded: number }>('/admin/email-templates/_queue/discard', body)).data.discarded,
}

export default emailTemplatesService
