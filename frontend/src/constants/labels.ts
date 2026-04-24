/**
 * Single source of truth for all display-label maps.
 * Import from here — never define these inline in individual page files.
 *
 * Organized by domain: Quality, Coaching, Write-ups.
 */

// Page-size to request when a screen wants the full list and intends to
// filter / search client-side. Aligned with the backend hard cap
// `MAX_PAGE_SIZE` in `backend/src/validation/common.ts` — keep these
// numbers in lock-step. The screens that use this value already render
// a "results truncated" indicator at `allItems.length >= CLIENT_FETCH_LIMIT`
// so users know to narrow filters when they hit it.
export const CLIENT_FETCH_LIMIT = 1000

import type { WriteUpType, WriteUpStatus } from '@/services/writeupService'
import type { CoachingPurpose, CoachingFormat, CoachingSourceType, CoachingStatus } from '@/services/trainingService'

// ── Universal status → display-text lookup (all domains) ─────────────────────

export const STATUS_LABELS: Record<string, string> = {
  SUBMITTED:           'Submitted',
  FINALIZED:           'Finalized',
  DISPUTED:            'Disputed',
  RESOLVED:            'Resolved',
  OPEN:                'Open',
  UPHELD:              'Upheld',
  REJECTED:            'Rejected',
  ADJUSTED:            'Adjusted',
  ACTIVE:              'Active',
  INACTIVE:            'Inactive',
  DRAFT:               'Draft',
  SCHEDULED:           'Scheduled',
  COMPLETED:           'Completed',
  CLOSED:              'Closed',
  IN_PROCESS:          'In Process',
  IN_PROGRESS:         'In Progress',
  AWAITING_CSR_ACTION: 'Awaiting Agent',
  QUIZ_PENDING:        'Quiz Pending',
  FOLLOW_UP_REQUIRED:  'Follow-Up',
  AWAITING_SIGNATURE:  'Awaiting Signature',
  SIGNED:              'Signed',
  FOLLOW_UP_PENDING:   'Follow-Up Pending',
  FOLLOW_UP_COMPLETED: 'Follow-Up Completed',
  CANCELED:            'Canceled',
}

// ── Quality ──────────────────────────────────────────────────────────────────

export const SUBMISSION_STATUSES = ['SUBMITTED', 'DISPUTED', 'FINALIZED'] as const

export const DISPUTE_STATUSES = ['OPEN', 'UPHELD', 'ADJUSTED'] as const

// ── Coaching ─────────────────────────────────────────────────────────────────

export const COACHING_PURPOSE_LABELS: Record<CoachingPurpose, string> = {
  WEEKLY:      'Weekly',
  PERFORMANCE: 'Performance',
  ONBOARDING:  'Onboarding',
}

export const COACHING_PURPOSE_STYLES: Record<CoachingPurpose, string> = {
  WEEKLY:      'bg-blue-50  text-blue-700',
  PERFORMANCE: 'bg-amber-50 text-amber-700',
  ONBOARDING:  'bg-teal-50  text-teal-700',
}

export const COACHING_FORMAT_LABELS: Record<CoachingFormat, string> = {
  ONE_ON_ONE:   '1-on-1',
  SIDE_BY_SIDE: 'Side-by-Side',
  TEAM_SESSION: 'Team',
}

export const COACHING_FORMAT_STYLES: Record<CoachingFormat, string> = {
  ONE_ON_ONE:   'bg-slate-100 text-slate-700',
  SIDE_BY_SIDE: 'bg-indigo-50 text-indigo-700',
  TEAM_SESSION: 'bg-purple-50 text-purple-700',
}

export const COACHING_SOURCE_LABELS: Record<CoachingSourceType, string> = {
  QA_AUDIT:             'QA Audit',
  MANAGER_OBSERVATION:  'Manager Observation',
  TREND:                'Trend',
  DISPUTE:              'Dispute',
  SCHEDULED:            'Scheduled',
  OTHER:                'Other',
}

// Mirrors backend Prisma enum CoachingSessionStatus exactly. Keep in sync with
// `CoachingStatus` in `@/services/trainingService` and the SQL whitelist in
// `coaching.controller.setSessionStatus`.
export const COACHING_STATUS_LABELS: Record<CoachingStatus, string> = {
  DRAFT:               'Draft',
  SCHEDULED:           'Scheduled',
  IN_PROCESS:          'In Process',
  AWAITING_CSR_ACTION: 'Awaiting Agent',
  QUIZ_PENDING:        'Quiz Pending',
  COMPLETED:           'Completed',
  FOLLOW_UP_REQUIRED:  'Follow-Up',
  CLOSED:              'Closed',
  CANCELED:            'Canceled',
}

// ── Write-Ups ────────────────────────────────────────────────────────────────

export const WRITE_UP_TYPE_LABELS: Record<WriteUpType, string> = {
  VERBAL_WARNING:  'Verbal Warning',
  WRITTEN_WARNING: 'Written Warning',
  FINAL_WARNING:   'Final Warning',
}

export const WRITE_UP_STATUS_LABELS: Record<WriteUpStatus, string> = {
  DRAFT:               'Draft',
  SCHEDULED:           'Scheduled',
  AWAITING_SIGNATURE:  'Awaiting Signature',
  SIGNED:              'Signed',
  SIGNATURE_REFUSED:   'Signature Refused',
  FOLLOW_UP_PENDING:   'Follow-Up Pending',
  FOLLOW_UP_COMPLETED: 'Follow-Up Completed',
  CLOSED:              'Closed',
}
