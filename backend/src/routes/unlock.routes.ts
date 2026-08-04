/**
 * Admin unlock / reopen routes. Mounted at /api/unlocks in index.ts.
 *
 *   POST /submission/:submissionId   reopen a SUBMITTED/FINALIZED review
 *   POST /dispute/:disputeId         reopen a closed dispute determination
 *   GET  /                           the Unlock Register (list + filters)
 *   GET  /stats                      register KPIs + groupings
 *   GET  /submission/:submissionId   unlock history for one review
 *
 * Admin-only at the router level, and again inside unlock.service.ts so the
 * rule survives any future caller that bypasses this router.
 */
import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import {
  postUnlockSubmission,
  postUnlockDispute,
  getUnlockRegister,
  getUnlockRegisterStats,
  getSubmissionUnlockHistory,
} from '../controllers/unlock.controller';

const router = express.Router();

router.use(authenticate as unknown as RequestHandler);
router.use(authorizeAdmin as unknown as RequestHandler);

router.get('/', getUnlockRegister as unknown as RequestHandler);
router.get('/stats', getUnlockRegisterStats as unknown as RequestHandler);
router.get('/submission/:submissionId', getSubmissionUnlockHistory as unknown as RequestHandler);
router.post('/submission/:submissionId', postUnlockSubmission as unknown as RequestHandler);
router.post('/dispute/:disputeId', postUnlockDispute as unknown as RequestHandler);

export default router;
