import express, { RequestHandler } from 'express';
import { authenticate, authorizePage } from '../middleware/auth';
import { 
  getForms, 
  getFormById, 
  createForm, 
  updateForm, 
  deactivateForm 
} from '../controllers/form.controller';

const router = express.Router();

const auth = authenticate as unknown as RequestHandler;
// Form mutations are gated by the `quality_forms` grant in
// `app_page_role_access` — change who can build forms via the admin
// Page Access screen, not by editing this file.
//
// GETs stay open to any authenticated user because CSRs, Trainers, and
// Managers all need to read form definitions to render audits, dashboards,
// and history.
const formsWrite = authorizePage('quality_forms', 'edit') as unknown as RequestHandler;

/**
 * @route GET /api/forms
 * @desc Get all forms with optional active filter and pagination
 * @access Authenticated
 */
router.get('/', auth, getForms as unknown as RequestHandler);

/**
 * @route GET /api/forms/:id
 * @desc Get form by ID with all categories and questions
 * @access Authenticated
 */
router.get('/:id', auth, getFormById as unknown as RequestHandler);

/**
 * @route POST /api/forms
 * @desc Create a new form with categories and questions
 * @access Private (QA, Admin)
 */
router.post('/', auth, formsWrite, createForm as unknown as RequestHandler);

/**
 * @route PUT /api/forms/:id
 * @desc Update an existing form (creates a new version)
 * @access Private (QA, Admin)
 */
router.put('/:id', auth, formsWrite, updateForm as unknown as RequestHandler);

/**
 * @route DELETE /api/forms/:id
 * @desc Deactivate a form
 * @access Private (QA, Admin)
 */
router.delete('/:id', auth, formsWrite, deactivateForm as unknown as RequestHandler);

export default router; 