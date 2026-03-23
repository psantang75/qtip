import express, { RequestHandler } from 'express';
import { 
  getPublishedCourses,
  getTrainingPaths,
  getAssignmentTargets
} from '../controllers/enrollment.controller';
import {
  getFilterOptions,
  generateReport,
  exportReport,
  getTrainingStats,
  getTraineeProgress,
  getTrainerCoachingSessions,
  getTrainerCoachingSessionDetails,
  createTrainerCoachingSession,
  updateTrainerCoachingSession,
  completeTrainerCoachingSession,
  reopenTrainerCoachingSession,
  downloadTrainerCoachingSessionAttachment,
  getTrainerTeamCSRs,
  getTrainerDashboardStats,
  getTrainerCSRActivity,
  getTrainerHealthCheck,
  getTrainerCompletedSubmissions,
  getTrainerSubmissionDetails
} from '../controllers/trainer.controller';
import { authenticate, authorizeTrainer } from '../middleware/auth';
import multer from 'multer';

const router = express.Router();

// Health check endpoint (no auth required for monitoring)
router.get('/health', getTrainerHealthCheck as unknown as RequestHandler);

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
      cb(new Error('Invalid file type'));
    }
  }
});

/**
 * @route GET /api/trainer/courses
 * @desc Get published courses for assignment
 * @access Private (Trainer)
 */
router.get('/courses', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getPublishedCourses as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/paths
 * @desc Get training paths for assignment
 * @access Private (Trainer)
 */
router.get('/paths', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainingPaths as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/targets
 * @desc Get CSRs and departments for assignment
 * @access Private (Trainer)
 */
router.get('/targets', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getAssignmentTargets as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/filters
 * @desc Get filter options for trainer reports
 * @access Private (Trainer)
 */
router.get('/filters', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getFilterOptions as unknown as RequestHandler
);

/**
 * @route POST /api/trainer/reports
 * @desc Generate trainer reports based on filters
 * @access Private (Trainer)
 */
router.post('/reports', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  generateReport as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/export/:report_id
 * @desc Export trainer report as CSV or PDF
 * @access Private (Trainer)
 */
router.get('/export/:report_id', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  exportReport as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/export/current
 * @desc Export current trainer report as CSV or PDF
 * @access Private (Trainer)
 */
router.get('/export/current', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  exportReport as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/stats
 * @desc Get training statistics for trainer dashboard
 * @access Private (Trainer)
 */
router.get('/stats', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainingStats as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/enrollments
 * @desc Get trainee progress with pagination
 * @access Private (Trainer)
 */
router.get('/enrollments', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTraineeProgress as unknown as RequestHandler
);

// COACHING SESSIONS ROUTES

/**
 * @route GET /api/trainer/coaching-sessions
 * @desc Get coaching sessions for trainers
 * @access Private (Trainer)
 */
router.get('/coaching-sessions', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerCoachingSessions as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/coaching-sessions/:sessionId
 * @desc Get coaching session details by ID
 * @access Private (Trainer)
 */
router.get('/coaching-sessions/:sessionId', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerCoachingSessionDetails as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/coaching-sessions/:sessionId/attachment
 * @desc Download coaching session attachment
 * @access Private (Trainer)
 */
router.get('/coaching-sessions/:sessionId/attachment', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  downloadTrainerCoachingSessionAttachment as unknown as RequestHandler
);

/**
 * @route POST /api/trainer/coaching-sessions
 * @desc Create new coaching session
 * @access Private (Trainer)
 */
router.post('/coaching-sessions', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  upload.single('attachment'),
  createTrainerCoachingSession as unknown as RequestHandler
);

/**
 * @route PUT /api/trainer/coaching-sessions/:sessionId
 * @desc Update coaching session
 * @access Private (Trainer)
 */
router.put('/coaching-sessions/:sessionId', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  upload.single('attachment'),
  updateTrainerCoachingSession as unknown as RequestHandler
);

/**
 * @route PATCH /api/trainer/coaching-sessions/:sessionId/complete
 * @desc Mark coaching session as completed
 * @access Private (Trainer)
 */
router.patch('/coaching-sessions/:sessionId/complete', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  completeTrainerCoachingSession as unknown as RequestHandler
);

/**
 * @route PATCH /api/trainer/coaching-sessions/:sessionId/reopen
 * @desc Re-open a completed coaching session (change status back to SCHEDULED)
 * @access Private (Trainer)
 */
router.patch('/coaching-sessions/:sessionId/reopen', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  reopenTrainerCoachingSession as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/team-csrs
 * @desc Get all CSRs that trainers can coach
 * @access Private (Trainer)
 */
router.get('/team-csrs', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerTeamCSRs as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/dashboard-stats
 * @desc Get dashboard statistics for trainer dashboard (trainer-specific)
 * @access Private (Trainer)
 */
router.get('/dashboard-stats', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerDashboardStats as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/csr-activity
 * @desc Get CSR activity data for trainer dashboard (trainer-specific)
 * @access Private (Trainer)
 */
router.get('/csr-activity', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerCSRActivity as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/completed
 * @desc Get completed QA submissions for trainers
 * @access Private (Trainer)
 */
router.get('/completed', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerCompletedSubmissions as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/completed/:id
 * @desc Get detailed information for a specific completed submission
 * @access Private (Trainer)
 */
router.get('/completed/:id', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainerSubmissionDetails as unknown as RequestHandler
);

export default router; 