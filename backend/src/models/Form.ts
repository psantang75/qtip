/**
 * TypeScript interfaces for Form-related tables
 * Aligned with database schema and frontend types for consistency
 */

export type interaction_type = 'CALL' | 'TICKET' | 'EMAIL' | 'CHAT' | 'UNIVERSAL';
export type QuestionType = 'YES_NO' | 'SCALE' | 'N_A' | 'TEXT' | 'INFO_BLOCK' | 'RADIO' | 'SUB_CATEGORY';
export type condition_type = 'EQUALS' | 'NOT_EQUALS' | 'EXISTS' | 'NOT_EXISTS';
export type logical_operator = 'AND' | 'OR';
export type MetadataFieldType = 'TEXT' | 'DROPDOWN' | 'DATE' | 'AUTO' | 'SPACER';

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
  parent_form_id?: number;
  user_version?: number;
  user_version_date?: string;
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
  user_version?: number;
  user_version_date?: string;
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