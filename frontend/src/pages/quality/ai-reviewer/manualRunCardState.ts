/**
 * Pure helpers for `ManualRunCard`'s attached-sources list.
 *
 * Lifted out of the React component so the contract that ships to the
 * backend (the `attached_sources[]` request body) can be unit-tested
 * without spinning up `@testing-library/react`. The component still
 * owns the React state — these are just the data transformations that
 * run on every state change.
 */

import type {
  ManualRunAttachedSource,
  ManualRunKind,
} from '@/services/aiReviewerService'

/**
 * Pick a sensible default kind for a freshly-attached row.
 *
 * Default to CONVERSATION when the primary is a TICKET / TASK (the
 * most common ticket+call pairing — "grade this ticket against the
 * call attached to it"); otherwise default to TICKET so a CALL primary
 * suggests attaching its underlying ticket. The user can always change
 * it via the segmented kind picker on the row.
 */
export function nextAttachedDefault(primaryKind: ManualRunKind): ManualRunKind {
  return primaryKind === 'CONVERSATION' ? 'TICKET' : 'CONVERSATION'
}

/**
 * Strip whitespace and drop blank rows. We do not mutate the on-screen
 * state (the user might be mid-paste with spaces in the buffer) — this
 * runs once at submit time to produce the request body's
 * `attached_sources[]`.
 */
export function trimAttachedSources(
  rows: ManualRunAttachedSource[]
): ManualRunAttachedSource[] {
  return rows
    .map((a) => ({ kind: a.kind, external_id: a.external_id.trim() }))
    .filter((a) => a.external_id.length > 0)
}

/**
 * "Submit is allowed" gate for the run button. The primary id must
 * be present, AND every attached row that the user started typing
 * must have a non-empty id (we don't silently drop in-progress edits
 * — the user gets blocked until they finish or remove the row).
 */
export function canRunManual(
  primaryExternalId: string,
  attached: ManualRunAttachedSource[]
): boolean {
  if (primaryExternalId.trim().length === 0) return false
  return attached.every((a) => a.external_id.trim().length > 0)
}
