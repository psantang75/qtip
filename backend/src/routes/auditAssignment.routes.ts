import express, { RequestHandler } from 'express';
import { 
  getAuditAssignments, 
  getAuditAssignmentById, 
  createAuditAssignment,
  createBatchAuditAssignments,
  updateAuditAssignment,
  deactivateAuditAssignment
} from '../controllers/auditAssignment.controller';
import { authenticate, authorizeQA } from '../middleware/auth';

const router = express.Router();

const auth = authenticate as unknown as RequestHandler;
// Audit assignments are QA-owned scheduling data (which CSRs to audit and when).
// All operations — including reads — are gated to QA + Admin to prevent
// non-QA accounts from enumerating who is being audited.
const qaOrAdmin = authorizeQA as unknown as RequestHandler;

/**
 * @route GET /api/audit-assignments
 * @desc Get all audit assignments with pagination and filtering
 * @access Private (QA, Admin)
 */
router.get('/', auth, qaOrAdmin, getAuditAssignments as unknown as RequestHandler);

/**
 * @route GET /api/audit-assignments/:id
 * @desc Get a single audit assignment by ID
 * @access Private (QA, Admin)
 */
router.get('/:id', auth, qaOrAdmin, getAuditAssignmentById as unknown as RequestHandler);

/**
 * @route POST /api/audit-assignments
 * @desc Create multiple audit assignments
 * @access Private (QA, Admin)
 */
router.post('/', auth, qaOrAdmin, createBatchAuditAssignments as unknown as RequestHandler);

/**
 * @route POST /api/audit-assignments/single
 * @desc Create a single audit assignment
 * @access Private (QA, Admin)
 */
router.post('/single', auth, qaOrAdmin, createAuditAssignment as unknown as RequestHandler);

/**
 * @route PUT /api/audit-assignments/:id
 * @desc Update an existing audit assignment
 * @access Private (QA, Admin)
 */
router.put('/:id', auth, qaOrAdmin, updateAuditAssignment as unknown as RequestHandler);

/**
 * @route DELETE /api/audit-assignments/:id
 * @desc Deactivate an audit assignment (soft delete)
 * @access Private (QA, Admin)
 */
router.delete('/:id', auth, qaOrAdmin, deactivateAuditAssignment as unknown as RequestHandler);

export default router; 