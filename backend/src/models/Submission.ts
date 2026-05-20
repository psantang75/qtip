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
  /**
   * Phase C (C4): multi-source case id (`<KIND>:<external_id>`) the
   * submission belongs to. When omitted, `MySQLSubmissionRepository`
   * derives it from the linked tickets/tasks/calls so callers don't
   * need to know the encoding.
   */
  case_id?: string | null;
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
 * the prompt schema in backend/prompts/ai-reviewer/system.v3.md.
 */
export interface SubmissionAiExtras {
  timeline?: AiTimelineItem[];
  observations?: AiObservation[];
  /** Phase A: explicit per-step playbook walk emitted before answers. */
  playbook_steps?: AiPlaybookStep[];
  /** Phase A: SPIN-style coaching block separate from the audit-chain narrative. */
  coaching?: AiCoaching;
  /**
   * Phase A: per-answer evidence keyed by question_id. The `evidence_source`
   * tells the reviewer where the AI looked (note date, transcript timestamp,
   * header field). The `evidence_quote` is the verbatim snippet (<= 240
   * chars). Either field may be empty when no quote was found.
   */
  answer_evidence?: Record<number, { evidence_source?: string; evidence_quote?: string }>;
  /**
   * Phase A: optional verification-pass output. Populated only when the
   * orchestrator triggered a follow-up Claude call (overall_confidence
   * < 0.6 or self-consistency violation). `warnings` may be empty if the
   * verifier found nothing to flag — we still record the trigger so QA
   * can audit how often verification fires.
   */
  verification?: AiVerification;
  /**
   * Phase A: self-consistency warnings raised at parse time (before any
   * verification call). e.g. "answer says steps not followed but
   * playbook_steps[] has no row with status=missing".
   */
  self_consistency_warnings?: string[];
  /**
   * Phase D (D1): cross-source faithfulness rubric emitted by the
   * synthesis pass. Single-source reviews get coverage=accuracy=
   * pii_discipline=1 and an empty discrepancies array; multi-source
   * reviews populate per-pair findings tying ticket notes to the call
   * transcript.
   */
  faithfulness?: AiFaithfulness;
}

export interface AiFaithfulnessDiscrepancy {
  /** What kind of mismatch the synthesizer found across sources. */
  kind: 'missing_in_notes' | 'contradiction' | 'embellishment' | 'pii_leak';
  /** The two sources the discrepancy spans, in `[A, B]` order. */
  between: Array<'TICKET' | 'TASK' | 'CALL'>;
  /** One-sentence summary the UI displays. */
  summary: string;
  /** Pass-1 trace claim ids when applicable; null when not from a claim. */
  claim_id_a?: number | null;
  claim_id_b?: number | null;
  severity: 'info' | 'warn' | 'critical';
}

export interface AiFaithfulness {
  /** Of the call's claims, fraction echoed in the ticket notes (0..1). */
  coverage: number;
  /** Of claims appearing in both sources, fraction that agree (0..1). */
  accuracy: number;
  /** 1.0 when no PII was captured; lower as severity grows (0..1). */
  pii_discipline: number;
  discrepancies: AiFaithfulnessDiscrepancy[];
}

export interface AiPlaybookStep {
  /** KB step name verbatim (do not paraphrase). */
  step: string;
  /**
   * Date of the note / transcript line / attachment that documents this step,
   * or null when status is `missing` or `not_applicable`.
   */
  evidence_note_date?: string | null;
  /**
   * - `done`: documented in a narrative note, transcript line, or attachment.
   * - `missing`: should have happened on the agent's actual path but no evidence.
   * - `out_of_order`: happened later than a step that should have followed it.
   * - `not_applicable`: legitimately skipped — issue resolved at an earlier
   *   step, or the step lay on a bypassed branch (alternate-path / decision-flow gate).
   */
  status: 'done' | 'missing' | 'out_of_order' | 'not_applicable';
}

export interface AiCoaching {
  /** Short kudos for the agent — what they did well that should be repeated. */
  wins: string[];
  /** QA-actionable gaps — process drift, missed best-practice, missing documentation. */
  gaps: string[];
  /** Concrete drills or follow-up actions tied to gaps where possible. */
  next_actions: string[];
}

export interface AiVerification {
  /** Why verification ran: 'low_confidence' | 'self_consistency' (or both, joined). */
  trigger: string;
  /** Per-answer warnings the verifier produced. Empty array means no issues found. */
  warnings: string[];
  /** Threshold used for low_confidence trigger (typically 0.6). */
  threshold: number;
  /**
   * Tier-1 (Item 2): asymmetric overall-confidence delta the verifier
   * applied to `ai_overall_confidence`. Bounded `[-0.20, +0.10]` —
   * verifier should mostly catch problems, not validate. Optional /
   * absent on legacy submissions persisted before deltas existed.
   */
  overall_delta?: number;
  /**
   * Tier-1 (Item 2): per-answer confidence deltas the verifier
   * applied. Map from `question_id` to delta in `[-0.20, +0.05]`.
   * Same anti-gaming bias as `overall_delta`. Absent / empty when
   * the verifier did not adjust any specific answer.
   */
  per_answer_deltas?: Record<number, number>;
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
  /**
   * Phase C (C3/C6): which source this row originated from in a
   * multi-source case. Synthesis pass populates these so the UI can
   * color-code rows by ticket vs. call. Optional for back-compat with
   * single-source ai_extras emitted before C3.
   */
  evidence_source_kind?: 'TICKET' | 'TASK' | 'CALL' | null;
  evidence_source_id?: string | number | null;
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