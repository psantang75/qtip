import express, { RequestHandler } from 'express';
import multer from 'multer';
// Rate limiting imports removed - rate limiting disabled
// import { lenientRateLimit, standardRateLimit, strictRateLimit } from '../middleware/rateLimiter';
import { 
  getCSRStats,
  getCSRDashboardStats,
  getCSRActivity
} from '../controllers/csrDashboard.controller';
import { 
  getCSRAudits,
  getCSRAuditDetails,
  isAuditDisputable,
  finalizeSubmission
} from '../controllers/csrAudit.controller';
import { 
  getTrainingCourses,
  getTrainingSummary,
  submitQuizAnswers,
  updateCourseProgress,
  completeCourse,
  getCertificate,
  getCertificates,
  getCourseContentForCSR,
  getLastViewedPosition,
  updateLastViewedPosition
} from '../controllers/csr.controller';
import { 
  getCSRCoachingSessions,
  getCSRCoachingSessionDetails,
  downloadCSRCoachingAttachment
} from '../controllers/csr.controller';
import { getDisputeHistory, submitDispute, downloadDisputeAttachment } from '../controllers/dispute.controller';
import { authenticate } from '../middleware/auth';
import { 
  validateSchema,
  CSRAuditFiltersSchema,
  AuditIdSchema,
  FinalizeSubmissionSchema,
  CoachingSessionFiltersSchema,
  SessionIdSchema,
  CertificateIdSchema
} from '../validation/csr.validation';

const router = express.Router();

// Configure multer for dispute file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, './uploads/disputes/');
    },
    filename: (req, file, cb) => {
      // Generate unique filename with timestamp
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow common document and image types for disputes
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword', // DOC
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
      'image/jpeg',
      'image/jpg',
      'image/png'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, JPEG, PNG files are allowed.'));
    }
  }
});

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

// Dashboard stats
router.get('/stats', getCSRStats as unknown as RequestHandler);
router.get('/dashboard-stats', getCSRDashboardStats as unknown as RequestHandler);
router.get('/csr-activity', getCSRActivity as unknown as RequestHandler);

// Audits with validation
router.get('/audits', 
  validateSchema(CSRAuditFiltersSchema), 
  getCSRAudits as unknown as RequestHandler
);
router.get('/audits/:id', 
  (req, res, next) => {
    console.log(`\n🔥 CSR ROUTE HIT: GET /audits/${req.params.id}`);
    next();
  },
  validateSchema(AuditIdSchema), 
  getCSRAuditDetails as unknown as RequestHandler
);
router.get('/audits/:id/disputable', 
  validateSchema(AuditIdSchema), 
  isAuditDisputable as unknown as RequestHandler
);
router.put('/audits/:id/finalize', 
  validateSchema(FinalizeSubmissionSchema), 
  finalizeSubmission as unknown as RequestHandler
);

// Training
router.get('/training/summary', getTrainingSummary as unknown as RequestHandler);
router.get('/enrollments', getTrainingCourses as unknown as RequestHandler);

// Course Content
router.get('/courses/:course_id', getCourseContentForCSR as unknown as RequestHandler);
router.get('/enrollments/:enrollment_id/course', getCourseContentForCSR as unknown as RequestHandler);

// Position Tracking
router.get('/enrollments/:enrollment_id/position', getLastViewedPosition as unknown as RequestHandler);
router.put('/enrollments/:enrollment_id/position', updateLastViewedPosition as unknown as RequestHandler);

// Course Progress and Completion
router.put('/enrollments/:enrollment_id/progress', updateCourseProgress as unknown as RequestHandler);
router.put('/enrollments/:enrollment_id/complete', completeCourse as unknown as RequestHandler);

// Quiz
router.post('/quizzes/:quiz_id/submit', submitQuizAnswers as unknown as RequestHandler);

// Certificates
router.get('/certificates', getCertificates as unknown as RequestHandler);
router.get('/certificates/:certificate_id', getCertificate as unknown as RequestHandler);

// Disputes
router.get('/disputes/history', getDisputeHistory as unknown as RequestHandler);
// Add the missing POST route for submitting disputes with multer middleware
router.post('/disputes', upload.single('attachment'), submitDispute as unknown as RequestHandler);
router.get('/disputes/:disputeId/attachment', downloadDisputeAttachment as unknown as RequestHandler);

// Coaching Sessions - rate limiting DISABLED
router.get('/coaching-sessions', 
  validateSchema(CoachingSessionFiltersSchema),
  getCSRCoachingSessions as unknown as RequestHandler
);
router.get('/coaching-sessions/:sessionId', 
  validateSchema(SessionIdSchema), 
  getCSRCoachingSessionDetails as unknown as RequestHandler
);
router.get('/coaching-sessions/:sessionId/attachment', 
  validateSchema(SessionIdSchema), 
  downloadCSRCoachingAttachment as unknown as RequestHandler
);

export default router; 