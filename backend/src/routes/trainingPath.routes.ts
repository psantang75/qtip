import { Router } from 'express';
import { authenticate, authorizeTrainer } from '../middleware/auth';
import { 
  getTrainingPaths, 
  getTrainingPathById, 
  createTrainingPath, 
  updateTrainingPath, 
  deleteTrainingPath
} from '../controllers/trainingPath.controller';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route GET /api/training-paths
 * @desc Get all training paths with pagination and search
 * @access Private (Trainer)
 */
router.get('/', authorizeTrainer, getTrainingPaths);

/**
 * @route GET /api/training-paths/:path_id
 * @desc Get a specific training path by ID with its courses
 * @access Private (Trainer)
 */
router.get('/:path_id', authorizeTrainer, getTrainingPathById);

/**
 * @route POST /api/training-paths
 * @desc Create a new training path with courses
 * @access Private (Trainer)
 */
router.post('/', authorizeTrainer, createTrainingPath);

/**
 * @route PUT /api/training-paths/:path_id
 * @desc Update an existing training path
 * @access Private (Trainer)
 */
router.put('/:path_id', authorizeTrainer, updateTrainingPath);

/**
 * @route DELETE /api/training-paths/:path_id
 * @desc Delete a training path
 * @access Private (Trainer)
 */
router.delete('/:path_id', authorizeTrainer, deleteTrainingPath);

export default router; 