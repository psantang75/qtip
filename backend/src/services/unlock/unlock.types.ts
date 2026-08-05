/**
 * Shared types for the admin unlock / reopen feature.
 */
import type { UnlockEntityType } from '../../generated/prisma/client';

export class UnlockServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'UNLOCK_ERROR') {
    super(message);
    this.name = 'UnlockServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UnlockRequest {
  /** A code from the admin-managed `unlock_reason` list (validated server-side). */
  reason_code: string;
  reason_note: string;
  /**
   * Break-glass. Required when the record is older than the configured
   * reopen window — the same two-step confirm `publishRange` uses for
   * publishing an elapsed week.
   */
  confirmBeyondWindow?: boolean;
}

export interface UnlockResult {
  unlock_id: number;
  entity_type: UnlockEntityType;
  entity_id: number;
  submission_id: number;
  prior_status: string;
  prior_score: number | null;
  new_status: string;
  relock_due_at: Date;
  beyond_window: boolean;
}

/**
 * What a submission unlock stashes so the sweep can put things back.
 * `submitted_at` is an ISO string because the column round-trips through
 * a JSON blob.
 */
export interface SubmissionPriorSnapshot {
  submitted_at: string;
}

/** What a dispute unlock clears and must therefore stash. */
export interface DisputePriorSnapshot {
  dispute_status: string;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}
