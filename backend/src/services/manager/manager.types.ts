/**
 * Shared types and the domain error class for the Manager service module.
 *
 * `ManagerServiceError` lets services throw with the same envelope contract the
 * legacy controller used. The `envelope` field controls which response shape
 * the controller layer emits; this preserves the divergent contracts the
 * frontend currently relies on (e.g. `/disputes` uses `{ success, message }`
 * while `/dashboard-stats` uses `{ message }`).
 */
export type ManagerEnvelope = 'success' | 'plain'

export class ManagerServiceError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly envelope: ManagerEnvelope

  constructor(
    message: string,
    statusCode = 500,
    code = 'MANAGER_ERROR',
    envelope: ManagerEnvelope = 'success',
  ) {
    super(message)
    this.name = 'ManagerServiceError'
    this.statusCode = statusCode
    this.code = code
    this.envelope = envelope
  }
}

export interface ManagerDashboardStats {
  reviewsCompleted: { thisWeek: number; thisMonth: number }
  disputes: { thisWeek: number; thisMonth: number }
  coachingSessions: { thisWeek: number; thisMonth: number }
}

export interface ManagerCSRActivityRow {
  id: number
  name: string
  department: string
  audits: number
  disputes: number
  coachingScheduled: number
  coachingCompleted: number
  audits_week: number
  disputes_week: number
  audits_month: number
  disputes_month: number
  coachingScheduled_week: number
  coachingCompleted_week: number
  coachingScheduled_month: number
  coachingCompleted_month: number
}

/** Whitelist of valid `coaching_type` values used during create/update. */
export const VALID_COACHING_TYPES = [
  'Classroom',
  'Side-by-Side',
  'Team Session',
  '1-on-1',
  'PIP',
  'Verbal Warning',
  'Written Warning',
] as const

export type CoachingType = (typeof VALID_COACHING_TYPES)[number]
