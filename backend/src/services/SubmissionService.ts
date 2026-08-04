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
import { deriveRollupAnswers, type RollupQuestionShape, type RollupAnswerShape } from '../utils/rollupEngine';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { notifySubmissionGraded } from './qa/qa.submissions.notify';

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
   * Runs the rollup engine on a soon-to-be-persisted submission payload and
   * returns a NEW answers array with any role=ROLLUP questions overwritten /
   * inserted with the engine's canonical derived value.
   *
   * Called from every write path (submitAudit, saveDraft,
   * promoteDraftToSubmitted) BEFORE handing the answers to the repository,
   * so the row that lands in `submission_answers` for a ROLLUP question is
   * always the engine's value rather than whatever the AI / human may have
   * tried to set. This keeps reads, exports, and the scoring re-loader in
   * lockstep — see backend/src/utils/scoringUtil.ts which also re-runs the
   * engine at score time as a safety net.
   *
   * Returns the input array unchanged when the form has no ROLLUP questions
   * so the common case stays a no-op.
   */
  private async applyRollupEngineToAnswers(
    form_id: number,
    answers: CreateSubmissionAnswerDTO[],
  ): Promise<CreateSubmissionAnswerDTO[]> {
    if (!form_id || !Array.isArray(answers)) return answers;

    const categories = await prisma.formCategory.findMany({
      where: { form_id },
      select: { id: true },
    });
    if (categories.length === 0) return answers;
    const categoryIds = categories.map((c) => c.id);

    const questionRows = await prisma.formQuestion.findMany({
      where: { category_id: { in: categoryIds } },
      select: {
        id: true,
        is_na_allowed: true,
        role: true,
        rollup_rule: true,
        rollup_member_question_ids: true,
      },
    });

    const hasAnyRollup = questionRows.some((q) => (q as any).role === 'ROLLUP');
    if (!hasAnyRollup) return answers;

    const conditionRows = await prisma.formQuestionCondition.findMany({
      where: { question_id: { in: questionRows.map((q) => q.id) } },
      select: {
        question_id: true,
        target_question_id: true,
        condition_type: true,
        target_value: true,
        group_id: true,
      },
    });

    const answersMap: Record<number, RollupAnswerShape> = {};
    for (const a of answers) {
      const qid = Number(a.question_id);
      if (!Number.isFinite(qid)) continue;
      answersMap[qid] = { question_id: qid, answer: a.answer ?? '', notes: a.notes ?? undefined };
    }

    // Compact visibility logic mirroring scoringUtil.buildVisibilityMap.
    // We could share that function but it lives in scoringUtil with private
    // scope; inlining the minimum here keeps the dependency arrow one-way
    // (SubmissionService -> rollupEngine, not -> scoringUtil internals).
    const NA = new Set(['na', 'n/a']);
    const YES_LIKE = new Set(['yes', 'true', '1', 'on']);
    const NO_LIKE = new Set(['no', 'false', '0', 'off']);
    const condsByQ: Record<number, typeof conditionRows> = {};
    for (const c of conditionRows) {
      if (!condsByQ[c.question_id]) condsByQ[c.question_id] = [];
      condsByQ[c.question_id].push(c);
    }
    const visibility: Record<number, boolean> = {};
    for (const q of questionRows) {
      const conds = condsByQ[q.id];
      if (!conds || conds.length === 0) { visibility[q.id] = true; continue; }
      const groups: Record<number, typeof conds> = {};
      for (const c of conds) {
        const g = c.group_id || 0;
        if (!groups[g]) groups[g] = [];
        groups[g].push(c);
      }
      const anyGroupTrue = Object.values(groups).some((g) =>
        g.every((c) => {
          const a = answersMap[c.target_question_id];
          if (!a) return c.condition_type === 'NOT_EXISTS';
          const aLower = String(a.answer || '').trim().toLowerCase();
          const vLower = String(c.target_value || '').trim().toLowerCase();
          switch (c.condition_type) {
            case 'EQUALS': {
              if (YES_LIKE.has(aLower) && YES_LIKE.has(vLower)) return true;
              if (NO_LIKE.has(aLower) && NO_LIKE.has(vLower)) return true;
              if (NA.has(aLower) && NA.has(vLower)) return true;
              return aLower === vLower;
            }
            case 'NOT_EQUALS': return aLower !== vLower;
            case 'EXISTS': return aLower !== '';
            case 'NOT_EXISTS': return aLower === '';
            default: return false;
          }
        }),
      );
      visibility[q.id] = anyGroupTrue;
    }

    const shapes: RollupQuestionShape[] = questionRows.map((q) => ({
      id: q.id,
      role: (q as any).role ?? 'DETAIL',
      rollup_rule: (q as any).rollup_rule ?? null,
      rollup_member_question_ids: Array.isArray((q as any).rollup_member_question_ids)
        ? ((q as any).rollup_member_question_ids as unknown[])
            .map((v) => (typeof v === 'number' ? v : Number(v)))
            .filter((n) => Number.isFinite(n) && n > 0)
        : null,
      is_na_allowed: !!q.is_na_allowed,
    }));

    const derived = deriveRollupAnswers(shapes, answersMap, visibility);
    if (derived.notes.length === 0) return answers;

    const byId = new Map<number, CreateSubmissionAnswerDTO>();
    for (const a of answers) byId.set(Number(a.question_id), a);
    for (const note of derived.notes) {
      const newAns = derived.answers[note.questionId];
      if (!newAns) continue;
      byId.set(note.questionId, {
        question_id: note.questionId,
        answer: newAns.answer,
        notes: newAns.notes ?? note.reason,
      });
    }
    return Array.from(byId.values());
  }

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

      // Inject canonical rollup answers BEFORE persistence so role=ROLLUP
      // questions land in submission_answers with the engine's value.
      const answersWithRollups = await this.applyRollupEngineToAnswers(
        submissionData.form_id,
        submissionData.answers ?? [],
      );

      // Set submission metadata
      const normalizedSubmissionData = {
        ...submissionData,
        answers: answersWithRollups,
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

      // Notify the CSR (and manager) that a review was done. Fires here on
      // SUBMITTED — not on finalize — so the agent learns of the review when
      // it happens. Reviewer kind drives cadence (human=immediate, AI=digest).
      await notifySubmissionGraded(submission_id, qa_id);

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
   * Load a DRAFT's saved answers back out so the audit form can rehydrate
   * it. Needed by the admin-unlock flow: reopening a review parks it in
   * DRAFT, and until this existed there was no way for a human QA to get
   * their own draft back on screen (the AI Reviewer draft endpoint rejects
   * anything not owned by the AI user).
   *
   * The response shape deliberately matches that endpoint's payload so
   * AuditFormPage's existing prefill effect works without a second branch.
   * Callers other than the owner must be admins — enforced here rather than
   * only at the route.
   */
  async getDraftForEdit(submission_id: number, requester_id: number, isAdmin: boolean) {
    if (!Number.isInteger(submission_id) || submission_id <= 0) {
      throw new SubmissionServiceError('Invalid submission ID', 'INVALID_SUBMISSION_ID', 400);
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submission_id },
      include: {
        form: { select: { id: true, form_name: true } },
        submission_answers: true,
        submission_metadata: true,
        submission_ticket_tasks: true,
        submission_calls: { include: { call: true } },
      },
    });
    if (!submission) {
      throw new SubmissionServiceError('Submission not found', 'SUBMISSION_NOT_FOUND', 404);
    }
    if (submission.status !== 'DRAFT') {
      throw new SubmissionServiceError(
        `Submission ${submission_id} is ${submission.status}, not DRAFT.`,
        'NOT_A_DRAFT',
        409
      );
    }
    if (submission.submitted_by !== requester_id && !isAdmin) {
      throw new SubmissionServiceError('This draft belongs to another reviewer', 'FORBIDDEN', 403);
    }

    return {
      submission_id: submission.id,
      form_id: submission.form_id,
      form_name: submission.form?.form_name ?? null,
      submitted_at: submission.submitted_at,
      submitted_by: submission.submitted_by,
      answers: submission.submission_answers.map((a) => ({
        question_id: a.question_id,
        answer: a.answer ?? '',
        notes: a.notes ?? '',
      })),
      metadata: submission.submission_metadata.map((m) => ({
        field_id: m.field_id,
        value: m.value ?? '',
      })),
      ticket_tasks: submission.submission_ticket_tasks.map((t) => ({
        kind: t.kind,
        external_id: Number(t.external_id),
      })),
      calls: submission.submission_calls
        .map((sc) => sc.call)
        .filter((c): c is NonNullable<typeof c> => c != null)
        .map((c) => ({
          id: c.id,
          call_id: c.call_id,
          csr_id: c.csr_id,
          customer_id: c.customer_id ?? null,
          call_date: c.call_date instanceof Date ? c.call_date.toISOString() : String(c.call_date),
          duration: c.duration,
          recording_url: c.recording_url ?? null,
          transcript: c.transcript ?? null,
        })),
    };
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
   *
   * `opts.preserveSubmittedAt` is for the admin-unlock re-submit path: a
   * corrected review must keep its original review date, otherwise the fix
   * silently moves the audit into the current reporting period and distorts
   * every trend that buckets on submitted_at. The AI promote path leaves it
   * off and keeps stamping "now", which is correct there — that draft has
   * never been submitted before.
   */
  async promoteDraftToSubmitted(
    submission_id: number,
    edits: { answers: CreateSubmissionAnswerDTO[]; metadata?: import('../models').SubmissionMetadataDTO[] },
    human_user_id: number,
    opts: { preserveSubmittedAt?: boolean } = {}
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

    // Promote-time rollup re-derivation: the human may have flipped a
    // DETAIL answer that feeds a rollup, so re-run the engine on the final
    // edits payload before persisting. Without this, the promoted row
    // would carry the AI's pre-edit rollup value while scoring uses the
    // new one (scoring re-derives at score time) - the DB and the score
    // would then disagree on the rollup answer.
    const editedAnswersWithRollups = await this.applyRollupEngineToAnswers(
      draft.form_id,
      edits.answers,
    );

    // Replace answers + metadata + flip status atomically. We do the
    // status/submitted_by/submitted_at flip + answer-replace inline
    // rather than calling repository.updateSubmission so we can update
    // submitted_by in the same transaction (the repo helper doesn't).
    await prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submission_id },
        data: {
          status: 'SUBMITTED',
          ...(opts.preserveSubmittedAt ? {} : { submitted_at: new Date() }),
          submitted_by: human_user_id,
        },
      });

      await tx.submissionAnswer.deleteMany({ where: { submission_id } });
      if (editedAnswersWithRollups.length > 0) {
        await tx.submissionAnswer.createMany({
          data: editedAnswersWithRollups.map((a) => ({
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

    // A human promoting an AI draft = the review is now done by a human;
    // notify the CSR immediately (reviewer kind resolves to qa).
    await notifySubmissionGraded(submission_id, human_user_id);

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

      // Apply the rollup engine on draft saves too so the AI-staged DRAFT
      // already shows the engine-derived value for any ROLLUP question -
      // otherwise the human auditor would see the AI's raw guess (or
      // blank) until promotion. Promote re-applies as a safety net.
      const answersWithRollups = await this.applyRollupEngineToAnswers(
        submissionData.form_id,
        submissionData.answers ?? [],
      );

      // Set draft metadata
      const normalizedSubmissionData = {
        ...submissionData,
        answers: answersWithRollups,
        submitted_by: qa_id,
        status: 'DRAFT' as SubmissionStatus,
        submitted_at: null
      };

      // Check if draft already exists. When a case_id is supplied, key dedup
      // off the case so multi-source / ticket-only / call-only runs each get
      // their own DRAFT row instead of clobbering unrelated stale drafts that
      // share (form_id, submitted_by, call_id IS NULL).
      // Pass `ai_provider` so AI Reviewer compare-mode runs (Claude vs
      // ChatGPT on the same case) land in two distinct DRAFT rows
      // instead of clobbering each other. Human saves and legacy callers
      // omit it and behave exactly as before.
      const existingDraft = await this.submissionRepository.getExistingDraft(
        submissionData.call_id ?? null,
        submissionData.form_id,
        qa_id,
        submissionData.case_id ?? null,
        submissionData.ai_provider ?? undefined
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