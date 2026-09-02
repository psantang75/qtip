/**
 * TypeScript interfaces for Form-related tables
 * Aligned with database schema and frontend types for consistency
 */

export type interaction_type = 'CALL' | 'TICKET' | 'EMAIL' | 'CHAT' | 'UNIVERSAL';
export type QuestionType =
  | 'YES_NO'
  | 'SCALE'
  | 'N_A'
  | 'TEXT'
  | 'INFO_BLOCK'
  | 'RADIO'
  | 'SUB_CATEGORY'
  | 'MULTI_SELECT'
  /**
   * Phase D (D1): a meta question type that the AI Reviewer auto-grades
   * from the synthesis-pass `faithfulness` object (coverage / accuracy /
   * pii_discipline). Renders as a read-only summary + raw scores in the
   * UI; humans don't fill it in. Reserved option_value strings:
   *   - "pass"  → all three subscores >= the form's faithfulness floor
   *   - "warn"  → at least one subscore below the floor
   *   - "fail"  → coverage or accuracy < 0.5, OR a critical discrepancy
   */
  | 'FAITHFULNESS';
export type condition_type = 'EQUALS' | 'NOT_EQUALS' | 'EXISTS' | 'NOT_EXISTS';
export type logical_operator = 'AND' | 'OR';
export type MetadataFieldType = 'TEXT' | 'DROPDOWN' | 'DATE' | 'AUTO' | 'SPACER';

/**
 * Question authoring role used by the form builder + rollupEngine.
 * DETAIL (default) is a normal graded question. ROLLUP is a category-summary
 * question whose answer is computed from `rollup_member_question_ids` via
 * the rule in `rollup_rule` (see backend/src/utils/rollupEngine.ts). The
 * scoring engine treats both roles identically once an answer is present.
 */
export type FormQuestionRole = 'DETAIL' | 'ROLLUP';

/**
 * Aggregation rule for ROLLUP questions. Currently only ANY_NO_TO_NO is
 * implemented; the type is open for future rules without a migration.
 *   ANY_NO_TO_NO -- any visible member = NO -> NO; all visible members NA
 *                   or zero visible members -> NA (if is_na_allowed) else
 *                   YES; otherwise YES.
 */
export type FormRollupRule = 'ANY_NO_TO_NO';

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
 * Form interface - matches forms table exactly
 * Made optional fields for frontend compatibility during creation
 */
export interface Form {
  id?: number;  // Optional for form creation
  form_name: string;
  interaction_type?: interaction_type;  // Optional for form creation
  version?: number;  // Optional for form creation
  created_by?: number;  // Optional for form creation
  created_at?: Date;  // Optional for form creation
  is_active: boolean;
  /**
   * Non-public form lifecycle mode. NULL/undefined = normal form governed by
   * `is_active` (Active/Inactive). 'INTERNAL' = hidden-capture form for internal
   * research: excluded from every agent/CSR and standard Quality surface and
   * surfaced only in the "Internal Research" Insights section. String (not
   * enum) so future modes need no migration.
   */
  access_mode?: string | null;
  /**
   * When `access_mode` is set, the role keys (lowercase, e.g. ["qa","manager"])
   * allowed to audit with this form AND view its results. `admin` is always
   * allowed implicitly. NULL/undefined for normal forms.
   */
  access_roles?: string[] | null;
  /**
   * Individual users (by id) additionally allowed to audit with this Internal form
   * and view its results, independent of `access_roles`. Lets you target "one
   * manager" instead of every manager. Persisted alongside roles in the single
   * `access_roles` JSON column as `user:<id>` tokens; surfaced separately here.
   */
  access_users?: number[] | null;
  parent_form_id?: number;
  /**
   * Stable identity shared by every version of the same logical form (the id of
   * the family's first version). Assigned automatically on create/update; not
   * client-supplied. See `forms.form_group_id` in the Prisma schema.
   */
  form_group_id?: number | null;
  user_version?: number;
  user_version_date?: string;
  critical_cap_percent?: number;
  /**
   * Per-form opt-in for the AI Reviewer feature. When true, the form is
   * eligible to be filled in by the AI Reviewer system user via
   * /api/ai-reviewer/*. The form auto-acquires a free-text "AI Reviewer
   * Feedback" question (in a new "AI Reviewer" category) at save time so
   * the AI's narrative always lands in a visible, scoreable slot.
   */
  ai_enabled?: boolean;

  /**
   * Free-text grading rules injected into the AI Reviewer's system prompt
   * as ADDITIONAL FORM-SPECIFIC GRADING RULES. Lets the form author teach
   * the AI policies that aren't expressible in the rubric questions
   * themselves (e.g. "NA is only valid when the agent explicitly notes
   * the step was unreachable"). Ignored when ai_enabled is false.
   */
  ai_review_guidance?: string | null;

  /**
   * When true, AI Reviewer submissions for this form are saved as DRAFT
   * (no scoring) so a human can review and promote them to SUBMITTED.
   * When false (default), AI submissions go straight to SUBMITTED with
   * scoring, exactly like a human-completed audit. Ignored when
   * ai_enabled is false.
   */
  ai_submit_as_draft?: boolean;

  /**
   * Trusted-mode sampling: percentage of AI submissions to route into the
   * QA review inbox (0-100). 10 = ~10% random check. Ignored when
   * ai_enabled or ai_submit_as_draft mean the submission is already
   * a DRAFT awaiting human review.
   */
  ai_sample_review_pct?: number;

  /**
   * Trusted-mode sampling: when true, AI submissions whose total_score is
   * below the form's critical-fail cap are ALWAYS routed to the QA
   * inbox, in addition to the random sample.
   */
  ai_sample_low_score_always?: boolean;

  /**
   * Layer 1 of the 4-layer system prompt: which `ai_base_prompt` row this
   * form should use. NULL = "inherit the seeded default for the requested
   * `prompt_kind`" (`base.v1` today). Edited from the Universal Base card
   * on the AI Reviewer Form Detail page.
   */
  ai_base_prompt_id?: number | null;

  /**
   * Per-form AI model provider. Controls which LLM the synthesis pipeline
   * calls. Allowed values: "anthropic" (Claude — default) and "openai"
   * (ChatGPT / GPT-5). Inherited across form versions through
   * `MySQLFormRepository.updateForm()` so the choice survives Save Form.
   */
  ai_model_provider?: string;
}

/**
 * Form category interface - matches form_categories table exactly
 * Made optional fields for frontend compatibility during creation
 */
export interface FormCategory {
  id?: number;  // Optional for category creation
  form_id?: number;  // Optional for category creation
  category_name: string;
  description?: string;
  weight: number;
  sort_order?: number;
}

/**
 * Form question condition interface - matches form_question_conditions table exactly
 * Made optional fields for frontend compatibility during creation
 */
export interface FormQuestionCondition {
  id?: number;  // Optional for condition creation
  question_id?: number;  // Optional for condition creation
  target_question_id: number;
  condition_type: condition_type;
  target_value?: string;
  logical_operator: logical_operator;
  group_id: number;
  sort_order: number;
  created_at?: Date;
}

/**
 * Form question interface - matches form_questions table exactly
 * Made optional fields for frontend compatibility during creation
 */
export interface FormQuestion {
  id?: number;  // Optional for question creation
  category_id?: number;  // Optional for question creation
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
  is_conditional?: boolean;
  conditional_question_id?: number;
  condition_type?: condition_type;
  conditional_value?: string;
  exclude_if_unmet?: boolean;
  conditional_logic?: {
    target_question_id: number;
    condition_type: condition_type;
    target_value?: string;
    exclude_if_unmet?: boolean;
  };
  
  // UI-only fields
  is_required?: boolean;
  visible_to_csr?: boolean; // Whether this question is visible to CSR users (default: true)
  is_critical?: boolean; // When true, a NO answer triggers the form's critical-fail cap

  /**
   * Declarative roll-up authoring (see backend/src/utils/rollupEngine.ts).
   * `role` defaults to 'DETAIL' so existing forms behave identically. When
   * set to 'ROLLUP' the question's answer is computed from
   * `rollup_member_question_ids` via `rollup_rule`; the human/AI does not
   * grade it directly. Scoring engine treats ROLLUP answers the same as
   * any other answer once the engine has filled them in.
   */
  role?: FormQuestionRole;
  rollup_rule?: FormRollupRule | null;
  rollup_member_question_ids?: number[] | null;

  // Related data (not in main table but joined)
  radio_options?: RadioOption[];
  conditions?: FormQuestionCondition[];
}

/**
 * Form metadata field interface - matches form_metadata_fields table exactly
 */
export interface FormMetadataField {
  id?: number;
  form_id?: number;
  interaction_type: interaction_type;
  field_name: string;
  field_type: MetadataFieldType;
  is_required: boolean;
  dropdown_source?: string;
  sort_order?: number;
  created_at?: Date;
}

/**
 * Data Transfer Objects for creating/updating forms
 */

export interface CreateFormDTO {
  form_name: string;
  interaction_type: interaction_type;
  created_by: number;
  is_active?: boolean;
  access_mode?: string | null;
  access_roles?: string[] | null;
  /** Individual-user grants for an Internal form; see Form.access_users. */
  access_users?: number[] | null;
  user_version?: number;
  user_version_date?: string;
  critical_cap_percent?: number;
  ai_enabled?: boolean;
  ai_review_guidance?: string | null;
  ai_submit_as_draft?: boolean;
  ai_sample_review_pct?: number;
  ai_sample_low_score_always?: boolean;
  ai_model_provider?: string;
  categories: CreateFormCategoryDTO[];
  metadata_fields?: CreateFormMetadataFieldDTO[];
}

export interface CreateFormCategoryDTO {
  category_name: string;
  description?: string;
  weight: number;
  sort_order?: number;
  questions: CreateFormQuestionDTO[];
}

export interface CreateQuestionConditionDTO {
  target_question_id: number;
  condition_type: condition_type;
  target_value?: string;
  logical_operator?: logical_operator;
  group_id?: number;
  sort_order?: number;
}

export interface CreateFormQuestionDTO {
  question_text: string;
  question_type: QuestionType;
  weight: number;
  sort_order?: number;
  is_na_allowed?: boolean;
  scale_min?: number;
  scale_max?: number;
  yes_value?: number;
  no_value?: number;
  na_value?: number;
  
  // Conditional logic properties (legacy support)
  is_conditional?: boolean;
  conditional_question_id?: number;
  condition_type?: condition_type;
  conditional_value?: string;
  exclude_if_unmet?: boolean;
  conditional_logic?: {
    target_question_id: number;
    condition_type: condition_type;
    target_value?: string;
    exclude_if_unmet?: boolean;
  };
  
  // UI-only fields
  is_required?: boolean;
  visible_to_csr?: boolean; // Whether this question is visible to CSR users (default: true)
  is_critical?: boolean; // When true, a NO answer triggers the form's critical-fail cap

  // Declarative roll-up authoring (see FormQuestion above + rollupEngine).
  role?: FormQuestionRole;
  rollup_rule?: FormRollupRule | null;
  rollup_member_question_ids?: number[] | null;

  conditions?: CreateQuestionConditionDTO[];
  radio_options?: CreateRadioOptionDTO[];
}

export interface CreateRadioOptionDTO {
  option_text: string;
  option_value: string;
  score: number;
  has_free_text: boolean;
  sort_order?: number;
}

export interface CreateFormMetadataFieldDTO {
  field_name: string;
  field_type: MetadataFieldType;
  interaction_type: interaction_type;
  is_required: boolean;
  dropdown_source?: string;
  sort_order?: number;
}

/**
 * Extended interfaces for retrieving complete form data
 */

export interface FormWithCategories extends Form {
  categories?: FormCategoryWithQuestions[];
  metadata_fields?: FormMetadataField[];
}

export interface FormCategoryWithQuestions extends FormCategory {
  questions?: FormQuestion[];
}

/**
 * Complete Form interface with nested data - matches frontend Form interface exactly
 * This is the unified interface used for full form operations
 */
export interface CompleteForm extends Form {
  categories: FormCategoryWithQuestions[];
  metadata_fields?: FormMetadataField[];
} 