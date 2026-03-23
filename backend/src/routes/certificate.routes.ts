import express, { RequestHandler } from 'express';
import { getCertificate } from '../controllers/csr.controller';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/**
 * @route GET /api/certificates/:certificate_id
 * @desc Get certificate for CSR
 * @access Private (CSR)
 */
router.get('/:certificate_id', 
  authenticate as unknown as RequestHandler,
  getCertificate as unknown as RequestHandler
);

export default router; 