import express, { RequestHandler } from 'express';
import { 
  getEnrollments,
  getEnrollmentById,
  createEnrollment,
  createBatchEnrollments,
  cancelEnrollment,
  getPublishedCourses,
  getTrainingPaths,
  getAssignmentTargets
} from '../controllers/enrollment.controller';
import { 
  updateCourseProgress,
  completeCourse
} from '../controllers/csr.controller';
import { authenticate, authorizeTrainer } from '../middleware/auth';

const router = express.Router();

/**
 * @route GET /api/enrollments
 * @desc Get all enrollments with pagination and filtering
 * @access Private (Trainer)
 */
router.get('/', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getEnrollments as unknown as RequestHandler
);

/**
 * @route GET /api/enrollments/:id
 * @desc Get a single enrollment by ID
 * @access Private (Trainer)
 */
router.get('/:id', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getEnrollmentById as unknown as RequestHandler
);

/**
 * @route POST /api/enrollments
 * @desc Create a single enrollment
 * @access Private (Trainer)
 */
router.post('/', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  createEnrollment as unknown as RequestHandler
);

/**
 * @route POST /api/enrollments/batch
 * @desc Create multiple enrollments in a batch
 * @access Private (Trainer)
 */
router.post('/batch', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  createBatchEnrollments as unknown as RequestHandler
);

/**
 * @route DELETE /api/enrollments/:id
 * @desc Cancel an enrollment
 * @access Private (Trainer)
 */
router.delete('/:id', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  cancelEnrollment as unknown as RequestHandler
);

/**
 * Trainer-specific endpoints for assignment
 */

/**
 * @route GET /api/trainer/courses
 * @desc Get published courses for assignment
 * @access Private (Trainer)
 */
router.get('/trainer/courses', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getPublishedCourses as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/paths
 * @desc Get training paths for assignment
 * @access Private (Trainer)
 */
router.get('/trainer/paths', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getTrainingPaths as unknown as RequestHandler
);

/**
 * @route GET /api/trainer/targets
 * @desc Get CSRs and departments for assignment
 * @access Private (Trainer)
 */
router.get('/trainer/targets', 
  authenticate as unknown as RequestHandler, 
  authorizeTrainer as unknown as RequestHandler,
  getAssignmentTargets as unknown as RequestHandler
);

/**
 * @route PUT /api/enrollments/:enrollment_id/progress
 * @desc Update course progress for CSR
 * @access Private (CSR)
 */
router.put('/:enrollment_id/progress', 
  authenticate as unknown as RequestHandler,
  updateCourseProgress as unknown as RequestHandler
);

/**
 * @route PUT /api/enrollments/:enrollment_id/complete
 * @desc Complete course for CSR
 * @access Private (CSR)
 */
router.put('/:enrollment_id/complete', 
  authenticate as unknown as RequestHandler,
  completeCourse as unknown as RequestHandler
);

export default router; 