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
 * NOTE: "Can this viewer see every CSR's write-ups?" is no longer a hardcoded
 * role check. It is the viewer's resolved `pw_list` access level (ALL/EDIT =>
 * see all, OWN => self-scoped), threaded in as `canViewAll` from
 * `req.pageAccess`. CSR isolation is still enforced unconditionally below via
 * `assertCsrSelfScope`.
 */

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

/**
 * Explicit CSR data-isolation invariant — defense-in-depth.
 *
 * Use in every detail / single-row path that reads a user-scoped write-up
 * row. If a CSR viewer ever ends up looking at someone else's row (e.g.
 * because someone misconfigured `app_page_role_access` to grant CSR
 * `can_access=true` on `pw_list`), this throws a 404 — same envelope as a
 * missing record so there's no information leak.
 *
 * INVARIANT: CSR data isolation must hold regardless of what the access
 * table says. This helper is the single greppable expression of that rule
 * for the write-up surface. Call it explicitly even when `canSeeAll`
 * already implies the right behaviour — the redundancy is intentional.
 */
export const assertCsrSelfScope = (
  viewerRole: string,
  viewerId: number,
  csrIdOnRow: number,
  status: string,
): void => {
  if (viewerRole !== 'CSR') return
  if (!isVisibleToCsr(csrIdOnRow, status, viewerId)) {
    throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  }
}
