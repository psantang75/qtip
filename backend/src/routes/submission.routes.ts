import express, { Request, Response, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { SubmissionService, SubmissionServiceError } from '../services/SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { finalizeSubmission } from '../controllers/qa.controller';

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
      console.error('[SUBMISSION ROUTE] Error getting assigned audits:', error);
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
      console.error('[SUBMISSION ROUTE] Error getting call with form:', error);
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

    console.log('[SUBMISSION ROUTE] Full request body:', JSON.stringify(req.body, null, 2));
    console.log('[SUBMISSION ROUTE] call_ids:', req.body.call_ids);
    console.log('[SUBMISSION ROUTE] call_data:', req.body.call_data);

    const submissionData = {
      form_id: req.body.form_id,
      call_id: req.body.call_id,
      call_ids: req.body.call_ids,
      call_data: req.body.call_data, // Add this line
      submitted_by: qa_id,
      answers: req.body.answers || [],
      metadata: req.body.metadata || []
    };

    console.log('[SUBMISSION ROUTE] Prepared submission data:', JSON.stringify(submissionData, null, 2));

    const result = await submissionService.submitAudit(submissionData, qa_id);
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof SubmissionServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      console.error('[SUBMISSION ROUTE] Error submitting audit:', error);
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
      call_ids: req.body.call_ids, // Add this line
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
      console.error('[SUBMISSION ROUTE] Error saving draft:', error);
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
      console.error('[SUBMISSION ROUTE] Error flagging submission:', error);
      res.status(500).json({ message: 'Failed to flag submission' });
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
 * @route PUT /api/submissions/:id/finalize
 * @desc Finalize a submission (QA/Manager/Admin)
 * @access Private (QA, Manager, Admin)
 */
router.put('/:id/finalize', authenticate as unknown as RequestHandler, finalizeSubmission as unknown as RequestHandler);

export default router; 