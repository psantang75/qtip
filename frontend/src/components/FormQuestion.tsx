import React from 'react';

/**
 * Available question types for form questions
 */
export type QuestionType = 
  | 'YES_NO'
  | 'SCALE' 
  | 'TEXT' 
  | 'INFO' 
  | 'RADIO' 
  | 'INFO_BLOCK' 
  | 'SUB_CATEGORY';

/**
 * Conditional logic types for question display
 */
export type ConditionType = 
  | 'EQUALS' 
  | 'NOT_EQUALS' 
  | 'EXISTS' 
  | 'NOT_EXISTS';

/**
 * Radio button option structure
 */
export interface RadioOption {
  /** Display text for the option */
  option_text: string;
  /** Value submitted when option is selected */
  option_value: string;
  /** Score assigned to this option */
  score: number;
}

/**
 * Comprehensive FormQuestion interface for review forms
 * 
 * Represents a single question within a review form with support for:
 * - Multiple question types (YES/NO, SCALE, TEXT, etc.)
 * - Conditional logic for dynamic forms
 * - Scoring and weighting systems
 * - Radio button options
 * - Required field validation
 */
export interface FormQuestion {
  /** Unique identifier for the question */
  id: number;
  
  /** Category this question belongs to */
  category_id: number;
  
  /** The actual question text displayed to users */
  question_text: string;
  
  /** Type of question determining UI and validation */
  question_type: QuestionType;
  
  /** Whether this question must be answered */
  is_required: boolean;
  
  /** Whether "N/A" is allowed as an answer */
  is_na_allowed: boolean;
  
  /** Weight of this question in overall scoring (0-100) */
  weight: number;
  
  /** Display order within the form */
  sort_order: number;
  
  // Scale question properties
  /** Minimum value for scale questions */
  scale_min?: number;
  
  /** Maximum value for scale questions */
  scale_max?: number;
  
  // YES/NO question scoring
  /** Score assigned when answer is "Yes" */
  yes_value?: number;
  
  /** Score assigned when answer is "No" */
  no_value?: number;
  
  // Radio question options
  /** Available options for radio/multiple choice questions */
  radio_options?: RadioOption[];
  
  // Conditional logic properties
  /** Whether this question has conditional display logic */
  is_conditional?: boolean;
  
  /** ID of question this one depends on */
  conditional_question_id?: number;
  
  /** Type of condition to check */
  condition_type?: ConditionType;
  
  /** Value to compare against for conditional logic */
  conditional_value?: string;
  
  /** Whether to exclude this question if condition is not met */
  exclude_if_unmet?: boolean;
  
  /** Complex conditional logic object */
  conditional_logic?: {
    target_question_id: number;
    condition_type: ConditionType;
    target_value?: string;
    exclude_if_unmet?: boolean;
  };
  
  /** Array of conditions for complex conditional logic */
  conditions?: Array<{
    id?: number;
    question_id?: number;
    target_question_id: number;
    condition_type: ConditionType;
    target_value?: string;
    logical_operator?: 'AND' | 'OR';
    group_id?: number;
    sort_order?: number;
  }>;
  
  // Legacy scoring properties for backward compatibility
  /** Alias for yes_value */
  score_if_yes?: number;
  
  /** Alias for no_value */
  score_if_no?: number;
  
  /** Alias for na_value */
  score_na?: number;
  
  /** N/A score value */
  na_value?: number;
  
  /** Alias for scale_max */
  max_scale?: number;
}

/**
 * Utility type for creating new form questions
 */
export type CreateFormQuestion = Omit<FormQuestion, 'id'> & {
  id?: number;
};

/**
 * Utility type for updating existing form questions
 */
export type UpdateFormQuestion = Partial<FormQuestion> & {
  id: number;
};

/**
 * Type guard to check if a question is a scale question
 */
export const isScaleQuestion = (question: FormQuestion): question is FormQuestion => {
  return question.question_type === 'SCALE' && 
         typeof question.scale_min === 'number' && 
         typeof question.scale_max === 'number';
};

/**
 * Type guard to check if a question is a radio question
 */
export const isRadioQuestion = (question: FormQuestion): question is FormQuestion => {
  return question.question_type === 'RADIO' && 
         Array.isArray(question.radio_options) && 
         question.radio_options.length > 0;
};

/**
 * Type guard to check if a question has conditional logic
 */
export const isConditionalQuestion = (question: FormQuestion): question is FormQuestion => {
  return question.is_conditional === true && 
         typeof question.conditional_question_id === 'number';
};

export default FormQuestion; 