/**
 * Pure rules for the Sales Productivity work rows — kept apart from the CRM
 * reads so they are unit-testable without a database.
 */
import type { TouchDetailRow } from '../insightsTouchDetail.service';

/** Lead Manager + Lead Manager - Unassigned Customers. */
export const LEAD_TASK_TYPE_IDS = new Set([11, 55]);
export const CONTACT_MANAGER_TASK_TYPE_ID = 10;

export type SalesTouchKind = 'lead' | 'contact_manager';

/** Which Leads-row bucket a touch row belongs to; null when it stays on the Tickets row. */
export function salesTouchKind(row: Pick<TouchDetailRow, 'itemType' | 'taskTypeId'>): SalesTouchKind | null {
  if (row.itemType !== 'task' || row.taskTypeId == null) return null;
  if (LEAD_TASK_TYPE_IDS.has(row.taskTypeId)) return 'lead';
  if (row.taskTypeId === CONTACT_MANAGER_TASK_TYPE_ID) return 'contact_manager';
  return null;
}

/**
 * The CRM writes this stamp as the note of the action that moved a lead into
 * "Proposal Issued". Every later note on that lead also carries the status id,
 * so the stamp — not the status column — is the one event per issue.
 */
const PROPOSAL_TRANSITION = /^Task Status Changed from \[[^\]]*\] to \[Proposal Issued\]/i;

export function isProposalTransition(row: Pick<TouchDetailRow, 'itemType' | 'taskTypeId' | 'note'>): boolean {
  return salesTouchKind(row) === 'lead' && PROPOSAL_TRANSITION.test(row.note.trim());
}

export type ProposalType = 'sub_only' | 'sub_player' | 'audio_system' | 'unclassified';

/** Line-item flags for one quote on a proposal, aggregated in SQL. */
export interface QuotePartFlags {
  /** Subscription part (ServiceRequired and not NotASub), as order_margin counts subs. */
  hasSub: boolean;
  /** Shippable part that requires a radio — the music player. */
  hasPlayer: boolean;
  /** Any other shippable hardware (speakers, amplifiers, volume controls). */
  hasHardware: boolean;
  /** Pro install labor (DMModelNumber PROFIN / PRO-INSTALL), as order_margin's with_labor. */
  hasInstall: boolean;
}

/**
 * Audio System wins over Sub + Player, which wins over Sub Only: a proposal
 * that designs a sound system is an audio-system proposal even though it also
 * carries the player and subscription.
 */
export function classifyProposal(quotes: QuotePartFlags[]): ProposalType {
  if (quotes.some((q) => q.hasHardware || q.hasInstall)) return 'audio_system';
  if (quotes.some((q) => q.hasPlayer)) return 'sub_player';
  if (quotes.some((q) => q.hasSub)) return 'sub_only';
  return 'unclassified';
}

/** "HH:MM" minus `minutes`, clamped to midnight. */
export function hmMinus(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = Math.max(0, h * 60 + m - Math.max(0, minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
