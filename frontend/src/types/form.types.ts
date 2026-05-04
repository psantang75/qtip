// Form types based on backend model
export type QuestionType = 'YES_NO' | 'SCALE' | 'N_A' | 'TEXT' | 'INFO_BLOCK' | 'RADIO' | 'SUB_CATEGORY' | 'MULTI_SELECT';
export type ConditionType = 'EQUALS' | 'NOT_EQUALS' | 'EXISTS' | 'NOT_EXISTS';
export type InteractionType = 'CALL' | 'TICKET' | 'EMAIL' | 'CHAT' | 'UNIVERSAL';
export type MetadataFieldType = 'TEXT' | 'DROPDOWN' | 'DATE' | 'AUTO' | 'SPACER';
export type LogicalOperator = 'AND' | 'OR';

/**
 * Radio option interface - matches radio_options table exactly
 */
export interface RadioOption {
  id?: number;
  question_id?: number;
  option_text: string;
  option_value: string;
  score: number;
  has_free_text: boolean;
  sort_order?: number;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Form question condition interface - matches form_question_conditions table exactly
 */
export interface FormQuestionCondition {
  id?: number;
  question_id?: number;
  target_question_id: number;
  condition_type: ConditionType;
  target_value?: string;
  logical_operator: LogicalOperator;
  group_id: number;
  sort_order: number;
  created_at?: Date;
}

/**
 * Form question interface - matches form_questions table exactly
 * Removed legacy fields and aligned with database schema
 */
export interface FormQuestion {
  id?: number;
  category_id?: number;
  question_text: string;
  question_type: QuestionType;
  weight: number;
  sort_order?: number;
  scale_min?: number;
  scale_max?: number;
  is_na_allowed?: boolean;
  yes_value?: number;
  no_value?: number;
  na_value?: number;
  
  // Legacy property aliases for backward compatibility
  score_if_yes?: number; // Alias for yes_value
  score_if_no?: number;  // Alias for no_value
  score_na?: number;     // Alias for na_value
  max_scale?: number;    // Alias for scale_max
  
  // Conditional logic properties (legacy support)
  conditional_question_id?: number;
  condition_type?: ConditionType;
  conditional_value?: string;
  exclude_if_unmet?: boolean;
  conditional_logic?: {
    target_question_id: number;
    condition_type: ConditionType;
    target_value?: string;
    exclude_if_unmet?: boolean;
  };
  
  // UI-only fields for form builder
  is_conditional?: boolean; // Used by form builder UI to control conditional logic panel
  conditions?: FormQuestionCondition[]; // Array of conditions for this question
  radio_options?: RadioOption[]; // Radio options if question_type is RADIO
  is_required?: boolean; // UI field for form builder
  visible_to_csr?: boolean; // Whether this question is visible to CSR users (default: true)
  is_critical?: boolean; // When true, a NO answer triggers the form's critical-fail cap
}

/**
 * Form category interface - matches form_categories table exactly
 */
export interface FormCategory {
  id?: number;
  form_id?: number;
  category_name: string;
  description?: string;
  weight: number;
  sort_order?: number;
  questions: FormQuestion[];
}

/**
 * Form metadata field interface - matches form_metadata_fields table exactly
 * Added missing database fields
 */
export interface FormMetadataField {
  id?: number;
  form_id?: number;
  interaction_type: InteractionType;
  field_name: string;
  field_type: MetadataFieldType;
  is_required: boolean;
  dropdown_source?: string; // Added missing field from database
  sort_order?: number; // Added missing field from database
  created_at?: Date;
}

/**
 * Submission metadata interface - matches submission_metadata table exactly
 */
export interface SubmissionMetadata {
  id?: number;
  submission_id?: number;
  field_id: number;
  value: string | null;
  date_value?: Date;
  created_at?: Date;
}

/**
 * Base Form interface - matches forms table exactly
 */
export interface BaseForm {
  id?: number;
  form_name: string;
  interaction_type?: InteractionType;
  version?: number;
  created_by?: number;
  created_at?: Date;
  is_active: boolean;
  parent_form_id?: number;
  user_version?: number;
  user_version_date?: string;
  critical_cap_percent?: number; // Score ceiling applied when any critical question is missed (default 79.00)
  /**
   * Per-form opt-in for the AI Reviewer feature. When true, this form is
   * eligible to be filled out by the synthetic AI Reviewer user via
   * /api/ai-reviewer/*. The form auto-acquires a free-text "AI Reviewer
   * Feedback" question on save so the AI's narrative always lands in a
   * visible answer slot. The form-builder shows a single checkbox to
   * toggle this flag.
   */
  ai_enabled?: boolean;

  /**
   * Free-text grading rules injected into the AI Reviewer's system prompt
   * as ADDITIONAL FORM-SPECIFIC GRADING RULES. Edited in the Form Builder
   * when ai_enabled is true; ignored otherwise.
   */
  ai_review_guidance?: string | null;

  /**
   * When true, AI Reviewer submissions for this form are saved as DRAFT
   * (no scoring) so a human can review and promote them to SUBMITTED.
   * When false, AI submissions go straight to SUBMITTED + scored, just
   * like a human-completed audit. Edited in the Form Builder; only
   * meaningful when ai_enabled is true.
   */
  ai_submit_as_draft?: boolean;

  /**
   * Trusted-mode sampling: percentage (0-100) of AI submissions on this
   * form that get routed back into the QA Review Inbox for re-audit.
   * Edited from the Calibration tab; ignored when the form is in
   * Calibrating mode (ai_submit_as_draft=true) since EVERY draft is
   * already routed for review.
   */
  ai_sample_review_pct?: number;

  /**
   * Trusted-mode sampling: when true, AI submissions whose total score
   * falls below the form's critical_cap_percent are ALWAYS routed to
   * the QA Inbox in addition to the random sample.
   */
  ai_sample_low_score_always?: boolean;
}

/**
 * Complete Form interface with nested data - unified across frontend and backend
 */
export interface Form extends BaseForm {
  categories: FormCategory[];
  metadata_fields?: FormMetadataField[];
}

/**
 * Answer interface for form submissions - standardized across all components
 */
export interface Answer {
  question_id: number;
  answer: string;
  notes?: string;
  score?: number;
}

/**
 * Submission status type - matches database enum plus preview mode
 */
export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED' | 'preview';

/**
 * Base submission interface - matches submissions table exactly
 */
export interface BaseSubmission {
  id?: number;
  form_id: number;
  call_id?: number | null;
  submitted_by: number;
  submitted_at?: Date;
  total_score?: number;
  status: SubmissionStatus;
}

/**
 * Complete submission interface with nested data - unified across frontend and backend
 */
export interface FormSubmission extends BaseSubmission {
  answers: Answer[] | Record<number, Answer>; // Support both formats for backward compatibility
  
  // Additional properties for form preview and scoring
  form?: Form;
  categoryScores?: CategoryScore[];
  score?: number;
  visibilityMap?: Record<number, boolean>;
  metadata?: SubmissionMetadata[];
}

/**
 * Category score interface for scoring calculations - standardized format
 */
export interface CategoryScore {
  categoryId: string | number;
  categoryName: string;
  earnedPoints: number;
  possiblePoints: number;
  rawScore: number;
  weightedScore: number;
}

/**
 * Create submission DTO for API calls
 */
export interface CreateSubmissionDTO {
  form_id: number;
  call_id?: number | null;
  call_ids?: number[]; // Add support for multiple calls
  submitted_by: number;
  answers: Answer[];
  status?: SubmissionStatus;
  metadata?: Array<{
    field_id: string | number;
    value: string;
  }>;
}

/**
 * UI state interfaces for form wizard
 */
export interface FormWizardState {
  currentStep: number;
  form: Form;
  errors: Record<string, string>;
  isSubmitting: boolean;
}

/**
 * Form list item interface for form management
 */
export interface FormListItem {
  id: number;
  form_name: string;
  interaction_type?: InteractionType;
  version: number;
  created_by: number;
  created_at: string;
  is_active: boolean;
  parent_form_id?: number;
} 