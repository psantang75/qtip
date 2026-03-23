/**
 * SubmissionService
 * 
 * Business logic layer for QA submission operations and scoring calculations.
 * Handles audit assignments, form submissions, draft management, and scoring logic.
 * Extracted from submission.controller.ts for Clean Architecture implementation.
 */

import { 
  CreateSubmissionDTO, 
  CreateSubmissionAnswerDTO,
  type SubmissionStatus,
  FlagSubmissionDTO
} from '../models';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { calculateFormScoreBySubmissionId, recalculateScores, getScoreBreakdown } from '../utils/scoringUtil';

/**
 * Custom error class for submission service business logic errors
 */
export class SubmissionServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: any
  ) {
    super(message);
    this.name = 'SubmissionServiceError';
  }
}

/**
 * Interface for audit assignment
 */
export interface AuditAssignment {
  assignment_id: number;
  call_id: number;
  call_external_id: string;
  form_id: number;
  form_name: string;
  call_date: string;
  call_duration: number;
  csr_name: string;
  department_name: string;
  submission_id: number;
  status: string;
}

/**
 * Interface for call with form data
 */
export interface CallWithForm {
  call: any;
  form: any;
  existingSubmission?: any;
}

/**
 * Interface for submission service operations
 */
export interface ISubmissionService {
  getAssignedAudits(qa_id: number, page?: number, limit?: number): Promise<{
    audits: AuditAssignment[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }>;
  getCallWithForm(call_id: number, form_id: number): Promise<CallWithForm>;
  submitAudit(submissionData: CreateSubmissionDTO, qa_id: number): Promise<{ submission_id: number; total_score: number; message: string }>;
  saveDraft(submissionData: CreateSubmissionDTO, qa_id: number): Promise<{ submission_id: number; message: string }>;
  flagSubmission(flagData: FlagSubmissionDTO, user_id: number): Promise<{ message: string }>;
  recalculateSubmissionScores(submissionIds: number[]): Promise<{ recalculated: Record<number, number>; message: string }>;
}

/**
 * SubmissionService implementation
 */
export class SubmissionService implements ISubmissionService {
  constructor(private submissionRepository: MySQLSubmissionRepository) {}

  /**
   * Get assigned audits for QA Analyst
   */
  async getAssignedAudits(qa_id: number, page: number = 1, limit: number = 10): Promise<{
    audits: AuditAssignment[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      if (!qa_id || qa_id <= 0) {
        throw new SubmissionServiceError(
          'Invalid QA ID provided',
          'INVALID_QA_ID',
          400
        );
      }

      const offset = (page - 1) * limit;
      const result = await this.submissionRepository.getAssignedAudits(qa_id, limit, offset);

      const totalPages = Math.ceil(result.total / limit);

      return {
        audits: result.audits,
        pagination: {
          total: result.total,
          page,
          limit,
          totalPages
        }
      };
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to retrieve assigned audits: ' + (error as Error).message,
        'AUDIT_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Get call details with form for QA review
   */
  async getCallWithForm(call_id: number, form_id: number): Promise<CallWithForm> {
    try {
      if (!call_id || call_id <= 0) {
        throw new SubmissionServiceError(
          'Invalid call ID provided',
          'INVALID_CALL_ID',
          400
        );
      }

      if (!form_id || form_id <= 0) {
        throw new SubmissionServiceError(
          'Invalid form ID provided',
          'INVALID_FORM_ID',
          400
        );
      }

      const result = await this.submissionRepository.getCallWithForm(call_id, form_id);

      if (!result.call) {
        throw new SubmissionServiceError(
          'Call not found',
          'CALL_NOT_FOUND',
          404
        );
      }

      if (!result.form) {
        throw new SubmissionServiceError(
          'Form not found',
          'FORM_NOT_FOUND',
          404
        );
      }

      return result;
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to retrieve call with form: ' + (error as Error).message,
        'CALL_FORM_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Submit a QA audit with score calculation
   */
  async submitAudit(submissionData: CreateSubmissionDTO, qa_id: number): Promise<{ submission_id: number; total_score: number; message: string }> {
    try {
      console.log('[SUBMISSION SERVICE] Starting submitAudit with data:', {
        form_id: submissionData.form_id,
        call_id: submissionData.call_id,
        call_ids: submissionData.call_ids,
        call_data: submissionData.call_data,
        answers_count: submissionData.answers?.length,
        metadata_count: submissionData.metadata?.length
      });

      // Validate submission data
      await this.validateSubmissionData(submissionData);

      // Set submission metadata
      const normalizedSubmissionData = {
        ...submissionData,
        submitted_by: qa_id,
        status: 'SUBMITTED' as SubmissionStatus,
        submitted_at: new Date()
      };

      console.log('[SUBMISSION SERVICE] Normalized submission data:', {
        form_id: normalizedSubmissionData.form_id,
        call_id: normalizedSubmissionData.call_id,
        call_ids: normalizedSubmissionData.call_ids,
        call_data: normalizedSubmissionData.call_data,
        status: normalizedSubmissionData.status
      });

      // Create submission in database
      const submission_id = await this.submissionRepository.createSubmission(normalizedSubmissionData);
      console.log('[SUBMISSION SERVICE] Created submission with ID:', submission_id);

      // Calculate scores using the existing scoring utility
      const scoreResult = await calculateFormScoreBySubmissionId(
        this.submissionRepository.getConnection(),
        submission_id
      );
      console.log('[SUBMISSION SERVICE] Calculated score:', scoreResult.total_score);

      // Update submission with calculated score
      await this.submissionRepository.updateSubmissionScore(submission_id, scoreResult.total_score);

      return {
        submission_id,
        total_score: scoreResult.total_score,
        message: 'Audit submitted successfully'
      };
    } catch (error) {
      console.error('[SUBMISSION SERVICE] Error in submitAudit:', error);
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to submit audit: ' + (error as Error).message,
        'AUDIT_SUBMISSION_ERROR',
        500
      );
    }
  }

  /**
   * Save draft submission
   */
  async saveDraft(submissionData: CreateSubmissionDTO, qa_id: number): Promise<{ submission_id: number; message: string }> {
    try {
      // Validate basic submission data (less strict for drafts)
      await this.validateDraftSubmissionData(submissionData);

      // Set draft metadata
      const normalizedSubmissionData = {
        ...submissionData,
        submitted_by: qa_id,
        status: 'DRAFT' as SubmissionStatus,
        submitted_at: null
      };

      // Check if draft already exists (only if call_id is provided)
      let existingDraft = null;
      if (submissionData.call_id !== undefined && submissionData.call_id !== null) {
        existingDraft = await this.submissionRepository.getExistingDraft(
          submissionData.call_id,
          submissionData.form_id,
          qa_id
        );
      } else {
        // Check for drafts without call_id
        existingDraft = await this.submissionRepository.getExistingDraft(
          null,
          submissionData.form_id,
          qa_id
        );
      }

      let submission_id: number;

      if (existingDraft) {
        // Update existing draft
        if (!existingDraft.id) {
          throw new SubmissionServiceError(
            'Existing draft has no ID',
            'INVALID_DRAFT_ID',
            500
          );
        }
        submission_id = existingDraft.id;
        await this.submissionRepository.updateSubmission(submission_id, normalizedSubmissionData);
      } else {
        // Create new draft
        submission_id = await this.submissionRepository.createSubmission(normalizedSubmissionData);
      }

      return {
        submission_id,
        message: 'Draft saved successfully'
      };
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to save draft: ' + (error as Error).message,
        'DRAFT_SAVE_ERROR',
        500
      );
    }
  }

  /**
   * Flag submission for review
   */
  async flagSubmission(flagData: FlagSubmissionDTO, user_id: number): Promise<{ message: string }> {
    try {
      // Validate flag data
      if (!flagData.submission_id || flagData.submission_id <= 0) {
        throw new SubmissionServiceError(
          'Invalid submission ID provided',
          'INVALID_SUBMISSION_ID',
          400
        );
      }

      if (!flagData.reason || flagData.reason.trim().length === 0) {
        throw new SubmissionServiceError(
          'Flag reason is required',
          'MISSING_FLAG_REASON',
          400
        );
      }

      // Verify submission exists
      const submission = await this.submissionRepository.getSubmissionById(flagData.submission_id);
      if (!submission) {
        throw new SubmissionServiceError(
          'Submission not found',
          'SUBMISSION_NOT_FOUND',
          404
        );
      }

      // Create flag record
      await this.submissionRepository.flagSubmission(flagData, user_id);

      return {
        message: 'Submission flagged successfully'
      };
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to flag submission: ' + (error as Error).message,
        'SUBMISSION_FLAG_ERROR',
        500
      );
    }
  }

  /**
   * Recalculate scores for multiple submissions
   */
  async recalculateSubmissionScores(submissionIds: number[]): Promise<{ recalculated: Record<number, number>; message: string }> {
    try {
      if (!submissionIds || submissionIds.length === 0) {
        throw new SubmissionServiceError(
          'No submission IDs provided',
          'NO_SUBMISSION_IDS',
          400
        );
      }

      // Validate all submission IDs
      for (const submission_id of submissionIds) {
        if (!submission_id || submission_id <= 0) {
          throw new SubmissionServiceError(
            'Invalid submission ID: ' + submission_id,
            'INVALID_SUBMISSION_ID',
            400
          );
        }
      }

      // Use the existing scoring utility for recalculation
      const recalculatedScores = await recalculateScores(
        this.submissionRepository.getConnection(),
        submissionIds
      );

      return {
        recalculated: recalculatedScores,
        message: `Successfully recalculated scores for ${Object.keys(recalculatedScores).length} submissions`
      };
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to recalculate scores: ' + (error as Error).message,
        'SCORE_RECALCULATION_ERROR',
        500
      );
    }
  }

  /**
   * Get detailed score breakdown for a submission
   */
  async getSubmissionScoreBreakdown(submission_id: number): Promise<any> {
    try {
      if (!submission_id || submission_id <= 0) {
        throw new SubmissionServiceError(
          'Invalid submission ID provided',
          'INVALID_SUBMISSION_ID',
          400
        );
      }

      // Verify submission exists
      const submission = await this.submissionRepository.getSubmissionById(submission_id);
      if (!submission) {
        throw new SubmissionServiceError(
          'Submission not found',
          'SUBMISSION_NOT_FOUND',
          404
        );
      }

      // Get score breakdown using existing utility
      const breakdown = await getScoreBreakdown(
        this.submissionRepository.getConnection(),
        submission_id
      );

      return breakdown;
    } catch (error) {
      if (error instanceof SubmissionServiceError) {
        throw error;
      }
      throw new SubmissionServiceError(
        'Failed to get score breakdown: ' + (error as Error).message,
        'SCORE_BREAKDOWN_ERROR',
        500
      );
    }
  }

  /**
   * Validate submission data for complete submissions
   */
  private async validateSubmissionData(submissionData: CreateSubmissionDTO): Promise<void> {
    // For complete submissions, call_id is optional but if provided must be valid
    // Note: Negative call_id values are allowed for virtual calls from PhoneSystem
    if (submissionData.call_id !== undefined && submissionData.call_id !== null && submissionData.call_id === 0) {
      throw new SubmissionServiceError(
        'Valid call ID is required when provided (0 is not valid)',
        'INVALID_CALL_ID',
        400
      );
    }

    if (!submissionData.form_id || submissionData.form_id <= 0) {
      throw new SubmissionServiceError(
        'Valid form ID is required',
        'INVALID_FORM_ID',
        400
      );
    }

    if (!submissionData.answers || submissionData.answers.length === 0) {
      throw new SubmissionServiceError(
        'At least one answer is required',
        'NO_ANSWERS',
        400
      );
    }

    // Validate each answer
    for (const answer of submissionData.answers) {
      await this.validateAnswer(answer);
    }
  }

  /**
   * Validate submission data for drafts (less strict)
   */
  private async validateDraftSubmissionData(submissionData: CreateSubmissionDTO): Promise<void> {
    // For drafts, call_id is optional but if provided must be valid
    // Note: Negative call_id values are allowed for virtual calls from PhoneSystem
    if (submissionData.call_id !== undefined && submissionData.call_id !== null && submissionData.call_id === 0) {
      throw new SubmissionServiceError(
        'Valid call ID is required when provided (0 is not valid)',
        'INVALID_CALL_ID',
        400
      );
    }

    if (!submissionData.form_id || submissionData.form_id <= 0) {
      throw new SubmissionServiceError(
        'Valid form ID is required',
        'INVALID_FORM_ID',
        400
      );
    }

    // For drafts, answers are optional, but if provided, they should be valid
    if (submissionData.answers) {
      for (const answer of submissionData.answers) {
        await this.validateAnswer(answer);
      }
    }
  }

  /**
   * Validate individual answer data
   */
  private async validateAnswer(answer: CreateSubmissionAnswerDTO): Promise<void> {
    if (!answer.question_id || answer.question_id <= 0) {
      throw new SubmissionServiceError(
        'Valid question ID is required for all answers',
        'INVALID_QUESTION_ID',
        400
      );
    }

    // Answer value can be empty for certain question types, but should be defined
    if (answer.answer === undefined || answer.answer === null) {
      throw new SubmissionServiceError(
        'Answer value is required',
        'MISSING_ANSWER_VALUE',
        400
      );
    }
  }
} 