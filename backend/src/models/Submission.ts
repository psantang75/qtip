/**
 * Submission model interfaces - aligned with frontend for consistency
 */

/**
 * Submission status type - matches frontend enum
 */
export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';

/**
 * Base submission interface - matches submissions table exactly
 * Made optional fields for frontend compatibility during creation
 */
export interface Submission {
  id?: number;  // Optional for submission creation
  form_id: number;
  call_id?: number | null;
  submitted_by: number;
  submitted_at?: Date;  // Optional for submission creation
  total_score?: number;  // Optional for submission creation
  status: SubmissionStatus;
}

export interface SubmissionWithDetails extends Submission {
  form_name?: string;
  call_external_id?: string;
  csr_name?: string;
  qa_name?: string;
  call_date?: Date;
  call_duration?: number;
  department_name?: string;
}

/**
 * Answer interface for form submissions - standardized across frontend and backend
 */
export interface Answer {
  question_id: number;
  answer: string;
  notes?: string;
  score?: number;
}

/**
 * Submission answer interface - matches submission_answers table exactly
 */
export interface SubmissionAnswer {
  id?: number;  // Optional for answer creation
  submission_id?: number;  // Optional for answer creation
  question_id: number;
  answer: string;
  notes?: string;
}

export interface SubmissionAnswerWithDetails extends SubmissionAnswer {
  question_text?: string;
  question_type?: string;
  category_name?: string;
  weight?: number;
  category_weight?: number;
}

export interface SubmissionMetadataDTO {
  field_id: number | string;
  value: string;
}

export type TicketTaskKind = 'TICKET' | 'TASK';

export interface TicketTaskRefDTO {
  kind: TicketTaskKind;
  /** External CRM id — `tblTicket.TicketID` (bigint) or `tblTask.TaskID` (int). */
  external_id: number;
}

export interface CreateSubmissionDTO {
  form_id: number;
  call_id?: number | null;
  call_ids?: number[];
  call_data?: Array<{
    call_id: string;
    department_id?: number | null;
    customer_id?: string | null;
    call_date?: string | Date;
    duration?: number;
    recording_url?: string | null;
    transcript?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  /**
   * Linked CRM tickets/tasks for this submission. Stored only as
   * references (kind + external_id) in `submission_ticket_tasks`; the
   * full ticket/task data is live-fetched from the CRM at view time.
   */
  ticket_tasks?: TicketTaskRefDTO[];
  /** CSR user ID resolved from the form's metadata CSR dropdown */
  csr_id?: number | null;
  submitted_by: number;
  answers: CreateSubmissionAnswerDTO[];
  status?: SubmissionStatus;
  metadata?: SubmissionMetadataDTO[];
  /**
   * AI Reviewer overall confidence (0..1). NULL for human-authored
   * submissions; populated by AIReviewerService.
   */
  ai_overall_confidence?: number | null;
  /**
   * Calibrated overall confidence after applying the form's active
   * ai_calibration_map (Phase 4 — empirical confidence calibration).
   * Equal to nominal when no active map exists.
   */
  ai_calibrated_confidence?: number | null;
  /**
   * AI Reviewer side outputs that don't have their own column —
   * currently `{ timeline: [...], observations: [...] }`. NULL for
   * human-authored submissions.
   */
  ai_extras?: SubmissionAiExtras | null;
}

export interface CreateSubmissionAnswerDTO {
  question_id: number;
  answer: string;
  notes?: string;
  /** AI per-answer confidence (0..1). NULL for human-authored answers. */
  ai_confidence?: number | null;
}

/**
 * Side outputs the AI Reviewer emits alongside scored answers.
 * Persisted as JSON in submissions.ai_extras. Keep this in sync with
 * the prompt schema in backend/prompts/ai-reviewer/system.v2.md.
 */
export interface SubmissionAiExtras {
  timeline?: AiTimelineItem[];
  observations?: AiObservation[];
}

export interface AiTimelineItem {
  /** Date and time as printed in the source (e.g. "Apr 23 9:14 AM"). */
  when: string;
  /** Author name, "Customer", or "Call" — whoever the source attributes the action to. */
  who: string;
  /** One short sentence describing what happened. */
  action: string;
  /** KB step name when the action maps to a documented step; null when not part of process. */
  kb_step?: string | null;
}

export type AiObservationKind =
  | 'documentation'
  | 'best_practice'
  | 'cadence'
  | 'process_drift'
  | 'pii'
  | 'other';

export type AiObservationSeverity = 'info' | 'warn';

export interface AiObservation {
  kind: AiObservationKind;
  severity: AiObservationSeverity;
  message: string;
  /** Which note date / which field this observation came from. */
  evidence?: string;
}

/**
 * Category score interface for scoring calculations - standardized format
 * Matches frontend CategoryScore interface exactly
 */
export interface CategoryScore {
  category_id: string | number;
  category_name: string;
  earnedPoints: number;
  possiblePoints: number;
  rawScore: number;
  weighted_score: number;
}

/**
 * Complete submission interface with nested data - unified across frontend and backend
 */
export interface FormSubmission extends Submission {
  answers: Answer[] | Record<number, Answer>; // Support both formats for backward compatibility
  
  // Additional properties for form preview and scoring
  form?: any; // Import from Form.ts to avoid circular dependency
  categoryScores?: CategoryScore[];
  score?: number;
  visibilityMap?: Record<number, boolean>;
  metadata?: SubmissionMetadataDTO[];
}

export interface UpdateSubmissionDTO {
  total_score?: number;
  status?: SubmissionStatus;
  answers?: CreateSubmissionAnswerDTO[];
}

export interface FlagSubmissionDTO {
  submission_id: number;
  disputed_by: number;
  reason: string;
} 