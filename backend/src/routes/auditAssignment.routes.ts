import express, { RequestHandler } from 'express';
import { 
  getAuditAssignments, 
  getAuditAssignmentById, 
  createAuditAssignment,
  createBatchAuditAssignments,
  updateAuditAssignment,
  deactivateAuditAssignment
} from '../controllers/auditAssignment.controller';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/**
 * @route GET /api/audit-assignments
 * @desc Get all audit assignments with pagination and filtering
 * @access Private (Admin)
 */
router.get('/', 
  authenticate as unknown as RequestHandler, 
  getAuditAssignments as unknown as RequestHandler
);

/**
 * @route GET /api/audit-assignments/:id
 * @desc Get a single audit assignment by ID
 * @access Private (Admin)
 */
router.get('/:id', 
  authenticate as unknown as RequestHandler, 
  getAuditAssignmentById as unknown as RequestHandler
);

/**
 * @route POST /api/audit-assignments
 * @desc Create multiple audit assignments
 * @access Private (Admin)
 */
router.post('/', 
  authenticate as unknown as RequestHandler, 
  createBatchAuditAssignments as unknown as RequestHandler
);

/**
 * @route POST /api/audit-assignments/single
 * @desc Create a single audit assignment
 * @access Private (Admin)
 */
router.post('/single', 
  authenticate as unknown as RequestHandler, 
  createAuditAssignment as unknown as RequestHandler
);

/**
 * @route PUT /api/audit-assignments/:id
 * @desc Update an existing audit assignment
 * @access Private (Admin)
 */
router.put('/:id', 
  authenticate as unknown as RequestHandler, 
  updateAuditAssignment as unknown as RequestHandler
);

/**
 * @route DELETE /api/audit-assignments/:id
 * @desc Deactivate an audit assignment (soft delete)
 * @access Private (Admin)
 */
router.delete('/:id', 
  authenticate as unknown as RequestHandler, 
  deactivateAuditAssignment as unknown as RequestHandler
);

export default router; 