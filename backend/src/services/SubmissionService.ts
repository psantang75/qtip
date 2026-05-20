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
import prisma from '../config/prisma';
import logger from '../config/logger';

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
  promoteDraftToSubmitted(submission_id: number, edits: { answers: CreateSubmissionAnswerDTO[]; metadata?: import('../models').SubmissionMetadataDTO[] }, human_user_id: number): Promise<{ submission_id: number; total_score: number; ai_answers_snapshot: Record<number, string>; human_answers: Record<number, string>; form_id: number; ticket_ids: number[]; call_ids: number[]; message: string }>;
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
      logger.info('[SUBMISSION SERVICE] Starting submitAudit with data:', {
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

      logger.info('[SUBMISSION SERVICE] Normalized submission data:', {
        form_id: normalizedSubmissionData.form_id,
        call_id: normalizedSubmissionData.call_id,
        call_ids: normalizedSubmissionData.call_ids,
        call_data: normalizedSubmissionData.call_data,
        status: normalizedSubmissionData.status
      });

      // Create submission in database
      const submission_id = await this.submissionRepository.createSubmission(normalizedSubmissionData);
      logger.info('[SUBMISSION SERVICE] Created submission with ID:', submission_id);

      // Calculate scores using the existing scoring utility
      const scoreResult = await calculateFormScoreBySubmissionId(
        this.submissionRepository.getConnection(),
        submission_id
      );
      logger.info('[SUBMISSION SERVICE] Calculated score:', scoreResult.total_score);

      // Update submission with calculated score
      await this.submissionRepository.updateSubmissionScore(submission_id, scoreResult.total_score);

      return {
        submission_id,
        total_score: scoreResult.total_score,
        message: 'Audit submitted successfully'
      };
    } catch (error) {
      logger.error('[SUBMISSION SERVICE] Error in submitAudit:', error);
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
   * Promotes an existing DRAFT submission (typically created by the AI
   * Reviewer) to SUBMITTED. Replaces the draft's answers and metadata
   * with the human's edits, re-attributes ownership to the human user,
   * runs scoring, and returns the AI's pre-promotion answers as a
   * snapshot so the caller can record a calibration data point.
   *
   * Mirrors the submitAudit scoring path so AI-promoted submissions
   * behave identically to a human-completed audit going forward.
   */
  async promoteDraftToSubmitted(
    submission_id: number,
    edits: { answers: CreateSubmissionAnswerDTO[]; metadata?: import('../models').SubmissionMetadataDTO[] },
    human_user_id: number
  ): Promise<{
    submission_id: number;
    total_score: number;
    ai_answers_snapshot: Record<number, string>;
    human_answers: Record<number, string>;
    form_id: number;
    ticket_ids: number[];
    call_ids: number[];
    message: string;
  }> {
    if (!Number.isInteger(submission_id) || submission_id <= 0) {
      throw new SubmissionServiceError('Invalid submission ID', 'INVALID_SUBMISSION_ID', 400);
    }
    if (!Number.isInteger(human_user_id) || human_user_id <= 0) {
      throw new SubmissionServiceError('Invalid human user ID', 'INVALID_USER_ID', 400);
    }
    if (!edits.answers || edits.answers.length === 0) {
      throw new SubmissionServiceError('Edits must include at least one answer', 'NO_EDITS', 400);
    }

    const draft = await prisma.submission.findUnique({
      where: { id: submission_id },
      include: {
        submission_answers: true,
        submission_ticket_tasks: { where: { kind: 'TICKET' }, select: { external_id: true } },
        // Phase B (B4): pull attached call ids so call-only promotions
        // can be recorded in ai_calibration_data with source_kind='CALL'.
        submission_calls: { select: { call_id: true } },
      },
    });
    if (!draft) {
      throw new SubmissionServiceError('Submission not found', 'SUBMISSION_NOT_FOUND', 404);
    }
    if (draft.status !== 'DRAFT') {
      throw new SubmissionServiceError(
        `Submission ${submission_id} is ${draft.status}, not DRAFT — cannot promote.`,
        'NOT_A_DRAFT',
        409
      );
    }

    // Snapshot the AI's answers BEFORE we overwrite them. This is the
    // calibration ground truth for "what did the AI originally say".
    const aiAnswersSnapshot: Record<number, string> = {};
    for (const a of draft.submission_answers) {
      aiAnswersSnapshot[a.question_id] = a.answer ?? '';
    }

    const humanAnswersMap: Record<number, string> = {};
    for (const a of edits.answers) {
      humanAnswersMap[a.question_id] = a.answer ?? '';
    }

    const ticketIds = draft.submission_ticket_tasks.map((t) => Number(t.external_id));
    // Phase B (B4): the AI Reviewer's call-only adapter inserts a single
    // virtual row into submission_calls (call_id = -1) when the source is
    // a Genesys conversation rather than a CRM call record. We surface
    // every attached call_id so the calibration writer can pick the right
    // one regardless of mode.
    const callIds = draft.submission_calls
      .map((c) => Number(c.call_id))
      .filter((n) => Number.isFinite(n) && n > 0);

    // Replace answers + metadata + flip status atomically. We do the
    // status/submitted_by/submitted_at flip + answer-replace inline
    // rather than calling repository.updateSubmission so we can update
    // submitted_by in the same transaction (the repo helper doesn't).
    await prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submission_id },
        data: {
          status: 'SUBMITTED',
          submitted_at: new Date(),
          submitted_by: human_user_id,
        },
      });

      await tx.submissionAnswer.deleteMany({ where: { submission_id } });
      if (edits.answers.length > 0) {
        await tx.submissionAnswer.createMany({
          data: edits.answers.map((a) => ({
            submission_id,
            question_id: a.question_id,
            answer: a.answer ?? null,
            notes: a.notes ?? null,
          })),
        });
      }

      if (edits.metadata) {
        await tx.submissionMetadata.deleteMany({ where: { submission_id } });
        if (edits.metadata.length > 0) {
          await tx.submissionMetadata.createMany({
            data: edits.metadata.map((m) => ({
              submission_id,
              field_id: Number(m.field_id),
              value: m.value ?? null,
            })),
          });
        }
      }
    });

    const scoreResult = await calculateFormScoreBySubmissionId(
      this.submissionRepository.getConnection(),
      submission_id
    );
    await this.submissionRepository.updateSubmissionScore(submission_id, scoreResult.total_score);

    logger.info(
      `[SUBMISSION SERVICE] Promoted DRAFT submission_id=${submission_id} to SUBMITTED ` +
        `(scored ${scoreResult.total_score}); attributed to user ${human_user_id}.`
    );

    return {
      submission_id,
      total_score: scoreResult.total_score,
      ai_answers_snapshot: aiAnswersSnapshot,
      human_answers: humanAnswersMap,
      form_id: draft.form_id,
      ticket_ids: ticketIds,
      call_ids: callIds,
      message: 'Draft promoted to SUBMITTED',
    };
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

      // Check if draft already exists. When a case_id is supplied, key dedup
      // off the case so multi-source / ticket-only / call-only runs each get
      // their own DRAFT row instead of clobbering unrelated stale drafts that
      // share (form_id, submitted_by, call_id IS NULL).
      const existingDraft = await this.submissionRepository.getExistingDraft(
        submissionData.call_id ?? null,
        submissionData.form_id,
        qa_id,
        submissionData.case_id ?? null
      );

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

    this.validateTicketTaskRefs(submissionData);
  }

  /**
   * Shared validator for the optional `ticket_tasks` payload — kind must
   * be TICKET|TASK and external_id must be a positive integer. Used by
   * both the strict submit path and the draft path so a malformed
   * reference can never reach the repository upsert.
   */
  private validateTicketTaskRefs(submissionData: CreateSubmissionDTO): void {
    if (!submissionData.ticket_tasks || submissionData.ticket_tasks.length === 0) return;

    for (const ref of submissionData.ticket_tasks) {
      if (ref.kind !== 'TICKET' && ref.kind !== 'TASK') {
        throw new SubmissionServiceError(
          `Invalid ticket/task kind: ${ref.kind}`,
          'INVALID_TICKET_TASK_KIND',
          400
        );
      }
      if (!Number.isInteger(ref.external_id) || ref.external_id <= 0) {
        throw new SubmissionServiceError(
          `Invalid ticket/task external_id: ${ref.external_id}`,
          'INVALID_TICKET_TASK_ID',
          400
        );
      }
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

    this.validateTicketTaskRefs(submissionData);
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