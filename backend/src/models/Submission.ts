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
  /** CSR user ID resolved from the form's metadata CSR dropdown */
  csr_id?: number | null;
  submitted_by: number;
  answers: CreateSubmissionAnswerDTO[];
  status?: SubmissionStatus;
  metadata?: SubmissionMetadataDTO[];
}

export interface CreateSubmissionAnswerDTO {
  question_id: number;
  answer: string;
  notes?: string;
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