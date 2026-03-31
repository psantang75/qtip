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
  getTrainerTeamCSRs,
  getTrainerDashboardStats,
  getTrainerCSRActivity,
  getTrainerHealthCheck,
  getTrainerCompletedSubmissions,
  getTrainerSubmissionDetails
} from '../controllers/trainer.controller';
import {
  getCoachingSessions,
  getCoachingSessionDetail,
  createCoachingSession,
  updateCoachingSession,
  deliverCoachingSession,
  completeCoachingSession,
  flagFollowUp,
  closeCoachingSession,
  downloadAttachment,
  getCSRCoachingHistory,
  getEligibleCoaches,
  setSessionStatus,
} from '../controllers/coaching.controller';
import {
  getResources,
  createResource,
  updateResource,
  toggleResourceStatus,
  downloadResourceFile,
  generateViewToken,
  serveFileWithToken,
} from '../controllers/resource.controller';
import {
  getQuizLibrary,
  getLibraryQuizDetail,
  createLibraryQuiz,
  updateLibraryQuiz,
  toggleQuizStatus,
  deleteLibraryQuiz,
} from '../controllers/quizLibrary.controller';
import {
  getReportsSummary,
  getCSRCoachingList
} from '../controllers/coachingReport.controller';
import { authenticate, authorizeCoachingUser, authorizeTrainer } from '../middleware/auth';
import multer from 'multer';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'image/jpeg', 'image/png', 'image/gif'
    ];
    if (allowed.includes(file.mimetype)) { cb(null, true); } else { cb(new Error('Invalid file type')); }
  }
});

const auth = authenticate as unknown as RequestHandler;
const coaching = authorizeCoachingUser as unknown as RequestHandler;
const trainer = authorizeTrainer as unknown as RequestHandler;

// Health check (no auth)
router.get('/health', getTrainerHealthCheck as unknown as RequestHandler);

// ─── Training / Enrollment ───────────────────────────────────────────────────
router.get('/courses', auth, trainer, getPublishedCourses as unknown as RequestHandler);
router.get('/paths', auth, trainer, getTrainingPaths as unknown as RequestHandler);
router.get('/targets', auth, trainer, getAssignmentTargets as unknown as RequestHandler);
router.get('/filters', auth, trainer, getFilterOptions as unknown as RequestHandler);
router.post('/reports', auth, trainer, generateReport as unknown as RequestHandler);
router.get('/export/:report_id', auth, trainer, exportReport as unknown as RequestHandler);
router.get('/export/current', auth, trainer, exportReport as unknown as RequestHandler);
router.get('/stats', auth, trainer, getTrainingStats as unknown as RequestHandler);
router.get('/enrollments', auth, trainer, getTraineeProgress as unknown as RequestHandler);
router.get('/team-csrs', auth, coaching, getTrainerTeamCSRs as unknown as RequestHandler);
router.get('/dashboard-stats', auth, coaching, getTrainerDashboardStats as unknown as RequestHandler);
router.get('/csr-activity', auth, coaching, getTrainerCSRActivity as unknown as RequestHandler);
router.get('/completed', auth, coaching, getTrainerCompletedSubmissions as unknown as RequestHandler);
router.get('/completed/:id', auth, coaching, getTrainerSubmissionDetails as unknown as RequestHandler);

// ─── Coaching Sessions ───────────────────────────────────────────────────────
router.get('/coaches', auth, coaching, getEligibleCoaches as unknown as RequestHandler);
router.get('/coaching-sessions', auth, coaching, getCoachingSessions as unknown as RequestHandler);
router.get('/coaching-sessions/:id/attachment', auth, coaching, downloadAttachment as unknown as RequestHandler);
router.get('/coaching-sessions/:id', auth, coaching, getCoachingSessionDetail as unknown as RequestHandler);
router.post('/coaching-sessions', auth, coaching, upload.single('attachment'), createCoachingSession as unknown as RequestHandler);
router.put('/coaching-sessions/:id', auth, coaching, upload.single('attachment'), updateCoachingSession as unknown as RequestHandler);
router.patch('/coaching-sessions/:id/status', auth, coaching, setSessionStatus as unknown as RequestHandler);
router.patch('/coaching-sessions/:id/deliver', auth, coaching, deliverCoachingSession as unknown as RequestHandler);
router.patch('/coaching-sessions/:id/complete', auth, coaching, completeCoachingSession as unknown as RequestHandler);
router.patch('/coaching-sessions/:id/flag-followup', auth, coaching, flagFollowUp as unknown as RequestHandler);
router.patch('/coaching-sessions/:id/close', auth, coaching, closeCoachingSession as unknown as RequestHandler);

// ─── CSR Coaching History (sidebar) ─────────────────────────────────────────
router.get('/csr-coaching-history/:csrId', auth, coaching, getCSRCoachingHistory as unknown as RequestHandler);

// ─── KB Resources ────────────────────────────────────────────────────────────
const resourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
    ];
    if (allowed.includes(file.mimetype)) { cb(null, true); } else { cb(new Error('Unsupported file type')); }
  },
});

router.get('/resources', auth, coaching, getResources as unknown as RequestHandler);
router.get('/resources/:id/file', auth, coaching, downloadResourceFile as unknown as RequestHandler);
router.get('/resources/:id/view-token', auth, coaching, generateViewToken as unknown as RequestHandler);
// No auth middleware — the token IS the authentication
router.get('/resources/:id/view', serveFileWithToken as unknown as RequestHandler);
router.post('/resources', auth, coaching, resourceUpload.single('file'), createResource as unknown as RequestHandler);
router.put('/resources/:id', auth, coaching, resourceUpload.single('file'), updateResource as unknown as RequestHandler);
router.patch('/resources/:id/status', auth, coaching, toggleResourceStatus as unknown as RequestHandler);

// ─── Quiz Library ─────────────────────────────────────────────────────────────
router.get('/quiz-library', auth, coaching, getQuizLibrary as unknown as RequestHandler);
router.get('/quiz-library/:id', auth, coaching, getLibraryQuizDetail as unknown as RequestHandler);
router.post('/quiz-library', auth, coaching, createLibraryQuiz as unknown as RequestHandler);
router.put('/quiz-library/:id', auth, coaching, updateLibraryQuiz as unknown as RequestHandler);
router.patch('/quiz-library/:id/status', auth, coaching, toggleQuizStatus as unknown as RequestHandler);
router.delete('/quiz-library/:id', auth, coaching, deleteLibraryQuiz as unknown as RequestHandler);

// ─── Coaching Reports ─────────────────────────────────────────────────────────
router.get('/reports/summary', auth, coaching, getReportsSummary as unknown as RequestHandler);
router.get('/reports/csr-list', auth, coaching, getCSRCoachingList as unknown as RequestHandler);

export default router;
