import express, { Request, Response, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { SubmissionService, SubmissionServiceError } from '../services/SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { serviceLogger } from '../config/logger';
import prisma from '../config/prisma';
import { findOpenUnlock, closeUnlock } from '../services/unlock/unlock.service';

const router = express.Router();

// Initialize submission service
const submissionRepository = new MySQLSubmissionRepository();
const submissionService = new SubmissionService(submissionRepository);

/**
 * Get all assigned audits for the current QA Analyst
 */
const getAssignedAudits = async (req: Request, res: Response) => {
  try {
    const qa_id = req.user?.user_id;
    if (!qa_id) {
      res.status(401).json({ message: 'Unauthorized access' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await submissionService.getAssignedAudits(qa_id, page, limit);
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'getAssignedAudits', error as Error);
      res.status(500).json({ message: 'Failed to fetch assigned audits' });
    }
  }
};

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
      req.user?.role === 'Admin',
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
 * Re-submit a review that an admin reopened.
 *
 * Reuses promoteDraftToSubmitted (which already does in-place answer
 * replacement, re-scoring and CSR notification) rather than POST / , which
 * would create a duplicate row. Requires an OPEN unlock so this cannot
 * become a general back-door edit of any draft.
 */
const resubmitUnlocked = async (req: Request, res: Response) => {
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

    const openUnlock = await findOpenUnlock('SUBMISSION', submission_id);
    if (!openUnlock) {
      res.status(409).json({
        message: 'This review is not currently reopened for correction.',
        code: 'NOT_UNLOCKED',
      });
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
    if (submission.submitted_by !== user_id && req.user?.role !== 'Admin') {
      res.status(403).json({ message: 'This review belongs to another reviewer' });
      return;
    }

    const result = await submissionService.promoteDraftToSubmitted(
      submission_id,
      { answers: req.body.answers || [], metadata: req.body.metadata || [] },
      user_id,
      // Keep the original review date so the correction doesn't jump the
      // audit into the current reporting period.
      { preserveSubmittedAt: true },
    );

    await closeUnlock('SUBMISSION', submission_id, user_id, {
      new_status: 'SUBMITTED',
      new_score: result.total_score,
    });

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      serviceLogger.error('SUBMISSION', 'resubmitUnlocked', error as Error);
      res.status(500).json({ message: 'Failed to re-submit review' });
    }
  }
};

/**
 * @route GET /api/submissions/assigned
 * @desc Get all assigned audits for the current QA Analyst
 * @access Private (QA Analyst)
 */
router.get('/assigned', authenticate as unknown as RequestHandler, getAssignedAudits);

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
 * @desc Re-submit a review an admin reopened; closes the unlock event
 * @access Private (original reviewer or Admin, only while unlocked)
 */
router.post('/:id/resubmit', authenticate as unknown as RequestHandler, resubmitUnlocked);

export default router; 