import express, { RequestHandler } from 'express';
import { disputeUpload } from '../middleware/disputeUpload';
import {
  getCSRStats,
  getCSRDashboardStats,
  getCSRActivity,
  getCSRAudits,
  getCSRAuditDetails,
  isAuditDisputable,
  finalizeSubmission,
  submitQuizAnswers,
  getCSRCoachingSessions,
  getCSRCoachingSessionDetails,
  downloadCSRCoachingAttachment,
  submitCSRResponse,
  getCSRResourceFile,
} from '../controllers/csr';
import { getDisputeHistory, submitDispute, downloadDisputeAttachment } from '../controllers/dispute.controller';
import { authenticate, authorizePage } from '../middleware/auth';
import {
  validateSchema,
  CSRAuditFiltersSchema,
  AuditIdSchema,
  FinalizeSubmissionSchema,
  CoachingSessionFiltersSchema,
  SessionIdSchema,
} from '../validation/csr.validation';

const router = express.Router();

// All CSR routes require authentication
router.use(authenticate as unknown as RequestHandler);

// Add a CSR role check middleware
const csrRoleCheck: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  
  // Check for CSR role
  if (req.user.role !== 'CSR') {
    res.status(403).json({ error: 'Access denied. CSR role required' });
    return;
  }
  
  next();
};

router.use(csrRoleCheck);

// Self-view page gates (scope model). These are layered on top of csrRoleCheck
// so an admin turning a page OFF for CSR (level=NONE) also closes the API, not
// just the nav link. Defaults grant CSR OWN, so this is a no-op until toggled.
//   My Reviews       → quality_submissions
//   Dispute History  → quality_disputes
//   My Training      → training_coaching
const ownReviews  = authorizePage('quality_submissions', 'view') as unknown as RequestHandler;
const ownDisputes = authorizePage('quality_disputes', 'view')    as unknown as RequestHandler;
const ownCoaching = authorizePage('training_coaching', 'view')   as unknown as RequestHandler;

// Dashboard stats
router.get('/stats', getCSRStats as unknown as RequestHandler);
router.get('/dashboard-stats', getCSRDashboardStats as unknown as RequestHandler);
router.get('/csr-activity', getCSRActivity as unknown as RequestHandler);

// Audits with validation
router.get('/audits', 
  ownReviews,
  validateSchema(CSRAuditFiltersSchema), 
  getCSRAudits as unknown as RequestHandler
);
router.get('/audits/:id',
  ownReviews,
  validateSchema(AuditIdSchema),
  getCSRAuditDetails as unknown as RequestHandler
);
router.get('/audits/:id/disputable', 
  ownReviews,
  validateSchema(AuditIdSchema), 
  isAuditDisputable as unknown as RequestHandler
);
router.put('/audits/:id/finalize', 
  ownReviews,
  validateSchema(FinalizeSubmissionSchema), 
  finalizeSubmission as unknown as RequestHandler
);

// Quiz
router.post('/quizzes/:quiz_id/submit', submitQuizAnswers as unknown as RequestHandler);

// Disputes
router.get('/disputes/history', ownDisputes, getDisputeHistory as unknown as RequestHandler);
// Add the missing POST route for submitting disputes with multer middleware
router.post('/disputes', ownDisputes, disputeUpload.single('attachment'), submitDispute as unknown as RequestHandler);
router.get('/disputes/:disputeId/attachment', ownDisputes, downloadDisputeAttachment as unknown as RequestHandler);

// Coaching Sessions (rate limiting applied globally via apiLimiter in index.ts)
router.get('/coaching-sessions', 
  ownCoaching,
  validateSchema(CoachingSessionFiltersSchema),
  getCSRCoachingSessions as unknown as RequestHandler
);
router.get('/coaching-sessions/:sessionId', 
  ownCoaching,
  validateSchema(SessionIdSchema), 
  getCSRCoachingSessionDetails as unknown as RequestHandler
);
router.get('/coaching-sessions/:sessionId/attachment', 
  ownCoaching,
  validateSchema(SessionIdSchema), 
  downloadCSRCoachingAttachment as unknown as RequestHandler
);
router.post('/coaching-sessions/:id/respond', ownCoaching, submitCSRResponse as unknown as RequestHandler);
router.get('/resources/:resourceId/file', getCSRResourceFile as unknown as RequestHandler);

export default router; 