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
import { normalizeConversationId } from '@/utils/conversationId'

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
 * Canonicalize one entered id. A conversation id is routinely pasted as the
 * whole Genesys Cloud URL the reviewer was looking at, so reduce that to the
 * id itself; ticket and task ids are plain numbers that only need the
 * surrounding whitespace removed.
 */
export function normalizeManualRunId(kind: ManualRunKind, raw: string): string {
  return kind === 'CONVERSATION' ? normalizeConversationId(raw) : raw.trim()
}

/**
 * Canonicalize every row and drop the blank ones, producing the request body's
 * `attached_sources[]`. Runs at submit time, so a row whose kind changed after
 * the id was typed is still normalized for the kind actually being submitted.
 */
export function normalizeAttachedSources(
  rows: ManualRunAttachedSource[]
): ManualRunAttachedSource[] {
  return rows
    .map((a) => ({ kind: a.kind, external_id: normalizeManualRunId(a.kind, a.external_id) }))
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
