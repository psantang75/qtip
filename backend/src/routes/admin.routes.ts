import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import multer from 'multer';
import { 
  getAdminStats,
  getCSRActivity,
  getCompletedForms,
  getCompletedFormDetails,
  exportCompletedForm,
  createAdminCoachingSession,
  getAdminCoachingSessions,
  exportAdminCoachingSessions,
  getAdminCoachingSessionDetails,
  updateAdminCoachingSession,
  completeAdminCoachingSession,
  reopenAdminCoachingSession,
  downloadAdminCoachingSessionAttachment,
  getAdminCSRs
} from '../controllers/admin.controller';

const router = express.Router();

// Configure multer for coaching file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed types: PDF, Word, Text, Images'));
    }
  }
});

/**
 * @route GET /api/admin/stats
 * @desc Get admin dashboard statistics
 * @access Private (Admin only)
 */
router.get('/stats', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getAdminStats as unknown as RequestHandler
);

/**
 * @route GET /api/admin/csr-activity
 * @desc Get CSR activity data for admin dashboard
 * @access Private (Admin only)
 */
router.get('/csr-activity', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getCSRActivity as unknown as RequestHandler
);

/**
 * @route GET /api/admin/completed-forms
 * @desc Get all completed form submissions with filtering
 * @access Private (Admin only)
 */
router.get('/completed-forms', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getCompletedForms as unknown as RequestHandler
);

/**
 * @route GET /api/admin/completed-forms/:id
 * @desc Get detailed information for a specific completed form submission
 * @access Private (Admin only)
 */
router.get('/completed-forms/:id', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getCompletedFormDetails as unknown as RequestHandler
);

/**
 * @route GET /api/admin/completed-forms/:id/export
 * @desc Export a completed form submission as CSV
 * @access Private (Admin only)
 */
router.get('/completed-forms/:id/export', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  exportCompletedForm as unknown as RequestHandler
);

/**
 * @route GET /api/admin/coaching-sessions
 * @desc Get coaching sessions with pagination and filters
 * @access Private (Admin only)
 */
router.get('/coaching-sessions', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getAdminCoachingSessions as unknown as RequestHandler
);

/**
 * @route GET /api/admin/coaching-sessions/export
 * @desc Export coaching sessions with current filters
 * @access Private (Admin only)
 */
router.get('/coaching-sessions/export',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  exportAdminCoachingSessions as unknown as RequestHandler
);

/**
 * @route GET /api/admin/coaching-sessions/:sessionId/attachment
 * @desc Download coaching session attachment
 * @access Private (Admin only)
 * @note Must be defined before the generic :sessionId route to avoid route matching conflicts
 */
router.get('/coaching-sessions/:sessionId/attachment', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  downloadAdminCoachingSessionAttachment as unknown as RequestHandler
);

/**
 * @route GET /api/admin/coaching-sessions/:sessionId
 * @desc Get coaching session details by ID
 * @access Private (Admin only)
 */
router.get('/coaching-sessions/:sessionId', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getAdminCoachingSessionDetails as unknown as RequestHandler
);

/**
 * @route POST /api/admin/coaching-sessions
 * @desc Create new coaching session
 * @access Private (Admin only)
 */
router.post('/coaching-sessions', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  upload.single('attachment'),
  createAdminCoachingSession as unknown as RequestHandler
);

/**
 * @route PUT /api/admin/coaching-sessions/:sessionId
 * @desc Update coaching session
 * @access Private (Admin only)
 */
router.put('/coaching-sessions/:sessionId', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  upload.single('attachment'),
  updateAdminCoachingSession as unknown as RequestHandler
);

/**
 * @route PATCH /api/admin/coaching-sessions/:sessionId/complete
 * @desc Mark coaching session as completed
 * @access Private (Admin only)
 */
router.patch('/coaching-sessions/:sessionId/complete', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  completeAdminCoachingSession as unknown as RequestHandler
);

/**
 * @route PATCH /api/admin/coaching-sessions/:sessionId/reopen
 * @desc Re-open a completed coaching session
 * @access Private (Admin only)
 */
router.patch('/coaching-sessions/:sessionId/reopen', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  reopenAdminCoachingSession as unknown as RequestHandler
);

/**
 * @route GET /api/admin/csrs
 * @desc Get all CSRs in the system
 * @access Private (Admin only)
 */
router.get('/csrs', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getAdminCSRs as unknown as RequestHandler
);

export default router; 