import express, { Request, Response, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { SubmissionService, SubmissionServiceError } from '../services/SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { serviceLogger } from '../config/logger';
import prisma from '../config/prisma';
import { findOpenUnlock, closeUnlock } from '../services/unlock/unlock.service';
import { isManagerOfSubmissionAgent } from '../services/manager/manager.access';

const router = express.Router();

// Initialize submission service
const submissionRepository = new MySQLSubmissionRepository();
const submissionService = new SubmissionService(submissionRepository);

/**
 * Get call details with form for QA review
 */
const getCallWithForm = async (req: Request, res: Response) => {
  try {
    const call_id = parseInt(req.params.call_id);
    const form_id = parseInt(req.query.form_id as string);

    if (!call_id || !form_id) {
      res.status(400).json({ message: 'Call ID and Form ID are required' });
      return;
    }

    const result = await submissionService.getCallWithForm(call_id, form_id);
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'getCallWithForm', error as Error);
      res.status(500).json({ message: 'Failed to fetch call with form' });
    }
  }
};

/**
 * Submit a QA audit
 */
const submitAudit = async (req: Request, res: Response) => {
  try {
    const qa_id = req.user?.user_id;
    if (!qa_id) {
      res.status(401).json({ message: 'Unauthorized access' });
      return;
    }

    const submissionData = {
      form_id:    req.body.form_id,
      call_id:    req.body.call_id,
      call_ids:   req.body.call_ids,
      call_data:  req.body.call_data,
      ticket_tasks: req.body.ticket_tasks,
      submitted_by: qa_id,
      answers:    req.body.answers  || [],
      metadata:   req.body.metadata || [],
    };

    const result = await submissionService.submitAudit(submissionData, qa_id);
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'submitAudit', error as Error);
      res.status(500).json({ message: 'Failed to submit audit' });
    }
  }
};

/**
 * Save a draft submission
 */
const saveDraft = async (req: Request, res: Response) => {
  try {
    const qa_id = req.user?.user_id;
    if (!qa_id) {
      res.status(401).json({ message: 'Unauthorized access' });
      return;
    }

    const submissionData = {
      form_id: req.body.form_id,
      call_id: req.body.call_id,
      call_ids: req.body.call_ids,
      ticket_tasks: req.body.ticket_tasks,
      submitted_by: qa_id,
      answers: req.body.answers || [],
      metadata: req.body.metadata || []
    };

    const result = await submissionService.saveDraft(submissionData, qa_id);
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'saveDraft', error as Error);
      res.status(500).json({ message: 'Failed to save draft' });
    }
  }
};

/**
 * Flag a submission for review
 */
const flagSubmission = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      res.status(401).json({ message: 'Unauthorized access' });
      return;
    }

    const flagData = {
      submission_id: req.body.submission_id,
      disputed_by: user_id,
      reason: req.body.reason
    };

    const result = await submissionService.flagSubmission(flagData, user_id);
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'flagSubmission', error as Error);
      res.status(500).json({ message: 'Failed to flag submission' });
    }
  }
};

/**
 * Load a DRAFT back into the audit form.
 *
 * Exists for the admin-unlock flow: reopening a review parks it in DRAFT,
 * and the AI Reviewer's draft endpoint only serves AI-owned rows.
 */
const getDraftForEdit = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      res.status(401).json({ message: 'Unauthorized access' });
      return;
    }
    const result = await submissionService.getDraftForEdit(
      parseInt(req.params.id, 10),
      user_id,
      req.user?.role,
    );
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'getDraftForEdit', error as Error);
      res.status(500).json({ message: 'Failed to load draft' });
    }
  }
};

/**
 * Submit / re-score a DRAFT review.
 *
 * A draft can arise two ways — a reviewer saved their in-progress work, or an
 * admin reopened a closed review (which parks it in DRAFT and leaves an OPEN
 * unlock). Either way this promotes it back to SUBMITTED, replacing answers in
 * place and re-scoring via `promoteDraftToSubmitted` (which only ever touches a
 * DRAFT, so this can never edit an already-scored review out from under the
 * unlock system).
 *
 * Allowed for the reviewer who authored it, an admin, or the manager of the CSR
 * agent the review is about. When an unlock is open it is closed here, and the
 * original review date + author are preserved so a correction does not restate
 * when the audit happened or who ran it. Who re-scored it is recorded in
 * `audit_logs` regardless.
 */
const submitDraft = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      res.status(401).json({ message: 'Unauthorized access' });
      return;
    }
    const submission_id = parseInt(req.params.id, 10);
    if (!Number.isInteger(submission_id) || submission_id <= 0) {
      res.status(400).json({ message: 'Invalid submission ID' });
      return;
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submission_id },
      select: { submitted_by: true },
    });
    if (!submission) {
      res.status(404).json({ message: 'Submission not found' });
      return;
    }

    const role = req.user?.role;
    let allowed = role === 'Admin' || submission.submitted_by === user_id;
    if (!allowed && role === 'Manager') {
      allowed = await isManagerOfSubmissionAgent(user_id, submission_id);
    }
    if (!allowed) {
      res.status(403).json({ message: 'This review belongs to another reviewer', code: 'FORBIDDEN' });
      return;
    }

    // A reopened review carries an OPEN unlock; a plain saved draft does not.
    // Preserve the original date/author only for a reopen — a fresh draft is
    // being submitted for the first time and should stamp its submit time.
    const openUnlock = await findOpenUnlock('SUBMISSION', submission_id);

    const result = await submissionService.promoteDraftToSubmitted(
      submission_id,
      { answers: req.body.answers || [], metadata: req.body.metadata || [] },
      user_id,
      openUnlock
        ? { preserveSubmittedAt: true, preserveSubmittedBy: true }
        : { preserveSubmittedBy: true },
    );

    if (openUnlock) {
      await closeUnlock('SUBMISSION', submission_id, user_id, {
        new_status: 'SUBMITTED',
        new_score: result.total_score,
      });
    }

    // Attribute the re-score even when it did not go through an unlock event,
    // so "who re-scored this draft" is always answerable.
    await prisma.auditLog.create({
      data: {
        user_id,
        action: 'submission.draft_submit',
        target_id: submission_id,
        target_type: 'SUBMISSION',
        details: JSON.stringify({
          new_score: result.total_score,
          reviewer_id: submission.submitted_by,
          via_reopen: !!openUnlock,
        }),
      },
    });

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'submitDraft', error as Error);
      res.status(500).json({ message: 'Failed to submit review' });
    }
  }
};

/**
 * @route GET /api/submissions/review/:call_id
 * @desc Get call details with form for QA review
 * @access Private (QA Analyst)
 */
router.get('/review/:call_id', authenticate as unknown as RequestHandler, getCallWithForm);

/**
 * @route POST /api/submissions
 * @desc Submit a QA audit
 * @access Private (QA Analyst)
 */
router.post('/', authenticate as unknown as RequestHandler, submitAudit);

/**
 * @route POST /api/submissions/draft
 * @desc Save a draft submission
 * @access Private (QA Analyst)
 */
router.post('/draft', authenticate as unknown as RequestHandler, saveDraft);

/**
 * @route POST /api/submissions/flag
 * @desc Flag a submission for review
 * @access Private (CSR, QA Analyst)
 */
router.post('/flag', authenticate as unknown as RequestHandler, flagSubmission);

/**
 * @route GET /api/submissions/:id/draft
 * @desc Load a DRAFT's saved answers back into the audit form
 * @access Private (draft owner or Admin)
 */
router.get('/:id/draft', authenticate as unknown as RequestHandler, getDraftForEdit);

/**
 * @route POST /api/submissions/:id/resubmit
 * @desc Submit / re-score a DRAFT; closes an unlock event if one is open
 * @access Private (the reviewer who authored it, the CSR agent's manager, or Admin)
 */
router.post('/:id/resubmit', authenticate as unknown as RequestHandler, submitDraft);

export default router; 