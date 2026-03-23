import express, { RequestHandler } from 'express';
import { submitQuizAnswers } from '../controllers/csr.controller';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/**
 * @route POST /api/quizzes/:quiz_id/submit
 * @desc Submit quiz answers for CSR
 * @access Private (CSR)
 */
router.post('/:quiz_id/submit', 
  authenticate as unknown as RequestHandler,
  submitQuizAnswers as unknown as RequestHandler
);

export default router; 