/**
 * Single source of truth for write-up label maps.
 * Import from here — never define these inline in individual files.
 */

import type { WriteUpType, WriteUpStatus } from '@/services/writeupService'

export const WRITE_UP_TYPE_LABELS: Record<WriteUpType, string> = {
  VERBAL_WARNING:  'Verbal Warning',
  WRITTEN_WARNING: 'Written Warning',
  FINAL_WARNING:   'Final Warning',
}


export const WRITE_UP_STATUS_LABELS: Record<WriteUpStatus, string> = {
  DRAFT:              'Draft',
  SCHEDULED:          'Scheduled',
  AWAITING_SIGNATURE: 'Awaiting Signature',
  SIGNED:             'Signed',
  FOLLOW_UP_PENDING:  'Follow-Up Pending',
  CLOSED:             'Closed',
}

export const COACHING_STATUS_LABELS: Record<string, string> = {
  SCHEDULED:           'Scheduled',
  IN_PROCESS:          'In Process',
  IN_PROGRESS:         'In Progress',
  AWAITING_CSR_ACTION: 'Awaiting CSR',
  COMPLETED:           'Completed',
  FOLLOW_UP_REQUIRED:  'Follow-Up',
  CLOSED:              'Closed',
}

export const PURPOSE_LABELS: Record<string, string> = {
  WEEKLY:      'Weekly',
  PERFORMANCE: 'Performance',
  ONBOARDING:  'Onboarding',
}
