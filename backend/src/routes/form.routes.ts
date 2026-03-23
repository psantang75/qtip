import express, { RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { 
  getForms, 
  getFormById, 
  createForm, 
  updateForm, 
  deactivateForm 
} from '../controllers/form.controller';

const router = express.Router();

/**
 * @route GET /api/forms
 * @desc Get all forms with optional active filter and pagination
 * @access Private (Admin)
 */
router.get('/', authenticate as unknown as RequestHandler, getForms as unknown as RequestHandler);

/**
 * @route GET /api/forms/:id
 * @desc Get form by ID with all categories and questions
 * @access Private (Admin)
 */
router.get('/:id', authenticate as unknown as RequestHandler, getFormById as unknown as RequestHandler);

/**
 * @route POST /api/forms
 * @desc Create a new form with categories and questions
 * @access Private (Admin)
 */
router.post('/', authenticate as unknown as RequestHandler, createForm as unknown as RequestHandler);

/**
 * @route PUT /api/forms/:id
 * @desc Update an existing form (creates a new version)
 * @access Private (Admin)
 */
router.put('/:id', authenticate as unknown as RequestHandler, updateForm as unknown as RequestHandler);

/**
 * @route DELETE /api/forms/:id
 * @desc Deactivate a form
 * @access Private (Admin)
 */
router.delete('/:id', authenticate as unknown as RequestHandler, deactivateForm as unknown as RequestHandler);

export default router; 