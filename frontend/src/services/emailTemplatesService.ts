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
  | 'assignee' | 'coach' | 'admins'

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
}

export default emailTemplatesService
