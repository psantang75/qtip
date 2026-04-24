import express, { RequestHandler } from 'express';
import {
  getAuditDetails,
  submitDispute,
  getDisputeHistory,
  getDisputeDetails,
  downloadDisputeAttachment,
  updateDispute
} from '../controllers/dispute.controller';
import { authenticate } from '../middleware/auth';
import { disputeUpload } from '../middleware/disputeUpload';

const router = express.Router();

// NOTE: GET /api/disputes/audits was removed during the pre-production review
// (item #13). The frontend always called GET /api/csr/audits (csrAudit.controller
// → CSRService) which is the canonical implementation; the variant that lived
// here used different filter names (form_id/start_date) and a different
// pagination shape, so leaving both wired up was a silent semantics fork.

/**
 * @route GET /api/disputes/audit/:submission_id
 * @desc Get details of a specific audit for dispute
 * @access Private (CSR)
 */
router.get('/audit/:submission_id', 
  authenticate as unknown as RequestHandler, 
  getAuditDetails as unknown as RequestHandler
);

/**
 * @route POST /api/disputes
 * @desc Submit a new dispute for an audit
 * @access Private (CSR)
 */
router.post('/', 
  authenticate as unknown as RequestHandler, 
  submitDispute as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/history
 * @desc Get dispute history for the current CSR
 * @access Private (CSR)
 */
router.get('/history', 
  authenticate as unknown as RequestHandler, 
  getDisputeHistory as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/:disputeId/attachment
 * @desc Download dispute attachment
 * @access Private (CSR, QA, Manager, Admin, Trainer)
 */
router.get('/:disputeId/attachment', 
  authenticate as unknown as RequestHandler, 
  downloadDisputeAttachment as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/:disputeId
 * @desc Get details of a specific dispute
 * @access Private (CSR, QA, Manager, Admin)
 */
router.get('/:disputeId', 
  authenticate as unknown as RequestHandler, 
  getDisputeDetails as unknown as RequestHandler
);

/**
 * @route PUT /api/disputes/:disputeId
 * @desc Update a dispute (reason and/or attachment)
 * @access Private (CSR - only for their own OPEN disputes)
 */
router.put('/:disputeId', 
  authenticate as unknown as RequestHandler,
  disputeUpload.single('attachment'),
  updateDispute as unknown as RequestHandler
);

export default router; 