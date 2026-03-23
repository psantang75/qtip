import { Router } from 'express';
import { authenticate, authorizeTrainer } from '../middleware/auth';
import { 
  getCourses, 
  getCourseById, 
  createCourse, 
  updateCourse, 
  deleteCourse,
  publishCourse,
  getCoursePages,
  createCoursePage,
  updateCoursePage,
  deleteCoursePage,
  autoSaveCoursePage
} from '../controllers/course.controller';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route GET /api/courses
 * @desc Get all courses with pagination and search
 * @access Private (All roles)
 */
router.get('/', getCourses);

/**
 * @route GET /api/courses/:course_id
 * @desc Get a specific course by ID with its pages and quiz
 * @access Private (All roles)
 */
router.get('/:course_id', getCourseById);

/**
 * @route POST /api/courses
 * @desc Create a new course with pages and optional quiz
 * @access Private (Trainer)
 */
router.post('/', authorizeTrainer, createCourse);

/**
 * @route PUT /api/courses/:course_id
 * @desc Update an existing course
 * @access Private (Trainer)
 */
router.put('/:course_id', authorizeTrainer, updateCourse);

/**
 * @route DELETE /api/courses/:course_id
 * @desc Delete a course if it has no enrollments
 * @access Private (Trainer)
 */
router.delete('/:course_id', authorizeTrainer, deleteCourse);

/**
 * @route PATCH /api/courses/:course_id/publish
 * @desc Publish a course (make it available to CSRs)
 * @access Private (Trainer)
 */
router.patch('/:course_id/publish', authorizeTrainer, publishCourse);

/**
 * @route GET /api/courses/:course_id/pages
 * @desc Get all pages for a specific course
 * @access Private (All roles)
 */
router.get('/:course_id/pages', getCoursePages);

/**
 * @route POST /api/courses/:course_id/pages
 * @desc Create a new page for a course
 * @access Private (Trainer)
 */
router.post('/:course_id/pages', authorizeTrainer, createCoursePage);

/**
 * @route PUT /api/courses/:course_id/pages/:pageId
 * @desc Update a specific course page
 * @access Private (Trainer)
 */
router.put('/:course_id/pages/:pageId', authorizeTrainer, updateCoursePage);

/**
 * @route DELETE /api/courses/:course_id/pages/:pageId
 * @desc Delete a specific course page
 * @access Private (Trainer)
 */
router.delete('/:course_id/pages/:pageId', authorizeTrainer, deleteCoursePage);

/**
 * @route PATCH /api/courses/:course_id/pages/:pageId/autosave
 * @desc Auto-save a course page (for visual editor)
 * @access Private (Trainer)
 */
router.patch('/:course_id/pages/:pageId/autosave', authorizeTrainer, autoSaveCoursePage);

export default router; 