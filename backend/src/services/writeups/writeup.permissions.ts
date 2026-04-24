/**
 * Writeup permission predicates and the status-transition state machine.
 *
 * Extracted from the old `controllers/writeup.controller.ts` during the
 * pre-production review (item #29). All visibility checks and lifecycle
 * guards land here so a single edit covers list / detail / status / signing
 * code paths.
 */

import { WriteUpServiceError } from './writeup.types'

/**
 * Roles that can see every CSR's write-ups. Anyone outside this set sees
 * only their own non-DRAFT records (CSR self-view).
 */
export const canSeeAll = (role: string): boolean =>
  ['Admin', 'QA', 'Manager'].includes(role)

/**
 * Status-transition matrix for write-ups. Keys are the current status,
 * values are the set of statuses the record may move to next. Anything not
 * listed is rejected by `assertTransition`.
 *
 *   DRAFT
 *     -> SCHEDULED                  (manager schedules the meeting)
 *   SCHEDULED
 *     -> AWAITING_SIGNATURE         (manager finalises the meeting)
 *   AWAITING_SIGNATURE
 *     -> SCHEDULED                  (manager recalls the document)
 *     -> SIGNED                     (CSR signs)
 *     -> SIGNATURE_REFUSED          (manager records refusal; may auto-route to FOLLOW_UP_PENDING)
 *   SIGNED / SIGNATURE_REFUSED
 *     -> CLOSED                     (no follow-up needed)
 *     -> FOLLOW_UP_PENDING          (follow-up captured)
 *   FOLLOW_UP_PENDING
 *     -> FOLLOW_UP_COMPLETED        (follow-up notes captured)
 *   FOLLOW_UP_COMPLETED
 *     -> CLOSED
 */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:               ['SCHEDULED'],
  SCHEDULED:           ['AWAITING_SIGNATURE'],
  AWAITING_SIGNATURE:  ['SCHEDULED', 'SIGNED', 'SIGNATURE_REFUSED'],
  SIGNED:              ['CLOSED', 'FOLLOW_UP_PENDING'],
  SIGNATURE_REFUSED:   ['CLOSED', 'FOLLOW_UP_PENDING'],
  FOLLOW_UP_PENDING:   ['FOLLOW_UP_COMPLETED'],
  FOLLOW_UP_COMPLETED: ['CLOSED'],
}

/** Throw if `nextStatus` is not a permitted move out of `currentStatus`. */
export const assertTransition = (currentStatus: string, nextStatus: string): void => {
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []
  if (!allowed.includes(nextStatus)) {
    throw new WriteUpServiceError(
      `Cannot transition from ${currentStatus} to ${nextStatus}`,
      422,
      'WRITEUP_INVALID_TRANSITION',
    )
  }
}

/**
 * CSRs can read their own non-DRAFT write-ups. Detail callers should run
 * this check after loading the row so unauthorised access returns the same
 * 404 a missing record would (no information leak about whether a record
 * exists for a different CSR).
 */
export const isVisibleToCsr = (csrIdOnRow: number, status: string, viewerId: number): boolean => {
  if (csrIdOnRow !== viewerId) return false
  if (status === 'DRAFT') return false
  return true
}
