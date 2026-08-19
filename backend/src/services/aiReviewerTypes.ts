/**
 * AI Reviewer — shared types + the service error class.
 *
 * Hoisted out of `AIReviewerService.ts` so both the engine AND the
 * case-loading layer (`aiReviewerCaseLoading.ts`) can depend on these
 * without importing the engine — which would create a circular import.
 * Keep this module dependency-light: only plain types, the error class,
 * and the tiny pure `formatCaseId` helper live here.
 */

import { type CRMNote } from './CRMService';

export class AIReviewerServiceError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'AIReviewerServiceError';
  }
}

export interface InteractionMaterial {
  /** Compact key/value summary of the audited record (for the prompt header). */
  header: Record<string, string>;
  /** Full ordered notes / transcript. */
  notesOrTranscript: CRMNote[];
  /** Free-text classification used to construct the KB search query. */
  classificationText: string;
  /** Author IDs whose recent notes seed the cut-and-paste heuristic. */
  noteAuthorIds: number[];
  /** When the interaction closed (validates "is closed" guard). */
  closedOn: Date | null;
  /** Status text from the source system (used to validate "is closed"). */
  statusText: string | null;
  /** Display name of the agent who handled the interaction (used to resolve qtip CSR). */
  agentDisplayName: string | null;
  /** Date the interaction took place / opened (drives the "Interaction Date" metadata field). */
  interactionDate: Date | null;
  /**
   * Mandatory KB URLs sourced from the interaction itself (today: the active
   * playbook links on a ticket's classification). These are the documented
   * process the agent was supposed to follow on this exact kind of work, so
   * they go into the prompt FIRST and outrank text-search hits.
   */
  mandatoryKbUrls: string[];
}

/**
 * Payload merged into the SubmissionService.submitAudit / saveDraft
 * call so the AI's submission is linked back to the source interaction.
 *
 * - Tickets and tasks land in `submission_ticket_tasks` (reference-only,
 *   live-fetched at view time).
 * - Calls land in `submission_calls` via the existing `call_ids` +
 *   `call_data` virtual-call upsert path used by the human audit flow.
 *
 * Phase C (C2): broadened from a discriminated union to a flat shape
 * that can carry BOTH ticket-task refs AND call refs in the same
 * payload. This is what unblocks combined ticket+call reviews — the
 * loadCase() loader can attach a call to a ticket-primary case (or
 * vice-versa) and the SubmissionService persists both sides.
 */
export interface SubmissionLinkPayload {
  ticket_tasks?: { kind: 'TICKET' | 'TASK'; external_id: number }[];
  call_ids?: number[];
  call_data?: Array<{
    call_id: string;
    call_date?: string | Date;
    duration?: number;
    recording_url?: string | null;
    transcript?: string | null;
  }>;
}

/**
 * Phase C (C2): typed reference to one source inside a Case. Tickets
 * and tasks use numeric CRM ids; calls use the Genesys conversation id
 * string (calls.call_id), so external_id is intentionally a union.
 */
export interface CaseSourceRef {
  kind: 'TICKET' | 'TASK' | 'CALL';
  external_id: string | number;
}

/**
 * Phase C (C2): a Case is the unit of review the AI reviewer grades.
 * Single-source reviews (ticket-only, call-only, task-only) collapse
 * to `attached: []`. Combined ticket+call reviews populate both sides.
 *
 * `id` is `KIND:external_id` of the primary source — that string is
 * what Phase C C4 stores in `submissions.case_id` so the inbox /
 * absorb / readiness routing can group multiple submissions under the
 * same case (e.g. the AI run + a later sample-review run).
 */
export interface Case {
  id: string;
  primary: CaseSourceRef;
  attached: CaseSourceRef[];
}

/** Format a CaseSourceRef as `KIND:external_id` for case_id. */
export function formatCaseId(ref: CaseSourceRef): string {
  return `${ref.kind}:${ref.external_id}`;
}
