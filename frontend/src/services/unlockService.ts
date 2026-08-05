import { api } from './authService'

/**
 * Admin unlock / reopen API. Every endpoint is admin-only server side; the
 * UI gates on `useQualityRole().isAdmin` purely to avoid showing an action
 * that would 403.
 */

export const UNLOCK_REASON_CODES = [
  'SCORING_ERROR',
  'WRONG_INTERACTION',
  'CALIBRATION_CORRECTION',
  'POLICY_CHANGE',
  'TECHNICAL_ISSUE',
  'AGENT_APPEAL',
  'OTHER',
] as const

export type UnlockReasonCode = (typeof UNLOCK_REASON_CODES)[number]

export const UNLOCK_REASON_LABELS: Record<UnlockReasonCode, string> = {
  SCORING_ERROR: 'Scoring error',
  WRONG_INTERACTION: 'Wrong interaction attached',
  CALIBRATION_CORRECTION: 'Calibration correction',
  POLICY_CHANGE: 'Policy change',
  TECHNICAL_ISSUE: 'Technical issue',
  AGENT_APPEAL: 'Agent appeal',
  OTHER: 'Other',
}

/** Minimum justification length, mirrored from unlock.validation.ts. */
export const UNLOCK_MIN_NOTE = 20

export interface UnlockPayload {
  // A code from the admin-managed `unlock_reason` list, not a fixed enum, so
  // admin-added reasons work. The server validates it against the live list.
  reason_code: string
  reason_note: string
  confirm_beyond_window?: boolean
}

export interface UnlockResult {
  unlock_id: number
  entity_type: 'SUBMISSION' | 'DISPUTE'
  entity_id: number
  submission_id: number
  prior_status: string
  prior_score: number | null
  new_status: string
  relock_due_at: string
  beyond_window: boolean
}

export interface UnlockRegisterRow {
  id: number
  entity_type: 'SUBMISSION' | 'DISPUTE'
  entity_id: number
  submission_id: number
  unlocked_at: string
  unlocked_by: number
  unlocked_by_name: string | null
  reason_code: string
  reason_note: string
  prior_status: string
  prior_score: number | null
  new_status: string | null
  new_score: number | null
  score_delta: number | null
  assigned_to: number | null
  assigned_to_name: string | null
  self_service: number
  beyond_window: number
  state: 'OPEN' | 'CLOSED' | 'AUTO_RELOCKED'
  relock_due_at: string
  closed_at: string | null
  form_name: string | null
  agent_name: string | null
}

export interface UnlockStats {
  total: number
  open: number
  closed: number
  auto_relocked: number
  beyond_window: number
  self_service: number
  avg_score_delta: number | null
  finalized_in_range: number
  per_hundred_finalized: number | null
  by_admin: Array<{ user_id: number; name: string | null; count: number; avg_score_delta: number | null }>
  by_assignee: Array<{ user_id: number; name: string | null; count: number }>
  by_reason: Array<{ reason_code: string; count: number }>
}

export interface UnlockRegisterFilters {
  page?: number
  limit?: number
  date_start?: string
  date_end?: string
  entity_type?: string
  reason_code?: string
  state?: string
  search?: string
}

function toParams(filters: UnlockRegisterFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === 'all') continue
    params.set(key, String(value))
  }
  return params.toString()
}

export const unlockService = {
  unlockSubmission: (submissionId: number, payload: UnlockPayload) =>
    api.post(`/unlocks/submission/${submissionId}`, payload).then((r) => r.data.data as UnlockResult),

  unlockDispute: (disputeId: number, payload: UnlockPayload) =>
    api.post(`/unlocks/dispute/${disputeId}`, payload).then((r) => r.data.data as UnlockResult),

  getRegister: (filters: UnlockRegisterFilters) =>
    api.get(`/unlocks?${toParams(filters)}`).then((r) => ({
      data: r.data.data as UnlockRegisterRow[],
      pagination: r.data.pagination as { total: number; page: number; limit: number; totalPages: number },
    })),

  getStats: (filters: UnlockRegisterFilters) =>
    api.get(`/unlocks/stats?${toParams(filters)}`).then((r) => r.data.data as UnlockStats),

  getSubmissionHistory: (submissionId: number) =>
    api.get(`/unlocks/submission/${submissionId}`).then((r) => r.data.data as UnlockRegisterRow[]),
}
