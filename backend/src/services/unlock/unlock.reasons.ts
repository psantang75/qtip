/**
 * Unlock/reopen reasons, read from the admin-managed `unlock_reason` list
 * (Admin -> List Management -> Quality) rather than a hardcoded enum. This is
 * the server-side source of truth for both validating a reopen request and
 * resolving a stored `record_unlock.reason_code` back to a display label.
 *
 * `item_key` is the stable code stored on the event; `label` is the editable
 * display text. Admin-added items have no `item_key`, so their code is derived
 * from the label exactly as the frontend does (see useUnlockReasons), keeping
 * the two sides in lockstep.
 */
import prisma from '../../config/prisma';
import { UnlockServiceError } from './unlock.types';

export interface UnlockReason {
  code: string;
  label: string;
}

/**
 * Built-in reasons, used only as a fallback when the managed list is empty
 * (e.g. before the seed migration runs) so reopening never hard-fails.
 */
const FALLBACK: UnlockReason[] = [
  { code: 'SCORING_ERROR', label: 'Scoring error' },
  { code: 'WRONG_INTERACTION', label: 'Wrong interaction attached' },
  { code: 'CALIBRATION_CORRECTION', label: 'Calibration correction' },
  { code: 'POLICY_CHANGE', label: 'Policy change' },
  { code: 'TECHNICAL_ISSUE', label: 'Technical issue' },
  { code: 'AGENT_APPEAL', label: 'Agent appeal' },
  { code: 'OTHER', label: 'Other' },
];

/** Mirrors the frontend deriveCode so admin-added labels map to a stable code. */
export function deriveUnlockReasonCode(label: string): string {
  return label.trim().toUpperCase().replace(/\s+/g, '_');
}

/** Active reasons in display order. Falls back to the built-in set when empty. */
export async function getActiveUnlockReasons(): Promise<UnlockReason[]> {
  const rows = await prisma.$queryRaw<Array<{ item_key: string | null; label: string }>>`
    SELECT item_key, label
    FROM list_items
    WHERE list_type = 'unlock_reason' AND is_active = 1
    ORDER BY sort_order ASC, id ASC
  `;
  if (rows.length === 0) return FALLBACK;
  return rows.map((r) => ({ code: r.item_key ?? deriveUnlockReasonCode(r.label), label: r.label }));
}

/**
 * Resolve a stored code to a label. Checks the active list first, then the
 * built-in set, so historical codes still render even after an admin renames
 * or deactivates a reason.
 */
export async function unlockReasonLabel(code: string): Promise<string> {
  const active = await getActiveUnlockReasons();
  return (
    active.find((r) => r.code === code)?.label ??
    FALLBACK.find((r) => r.code === code)?.label ??
    code
  );
}

/**
 * Guard the reopen write path: the reason must be one the managed list
 * currently offers. Keeps the stored codes governed by List Management instead
 * of accepting any string.
 */
export async function assertKnownReasonCode(code: string): Promise<void> {
  const active = await getActiveUnlockReasons();
  if (!active.some((r) => r.code === code)) {
    throw new UnlockServiceError(
      'That reopen reason is not available. Pick one from the list.',
      400,
      'REASON_INVALID',
    );
  }
}
