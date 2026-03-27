import express, { RequestHandler } from 'express';
import { submitQuizAnswers } from '../controllers/csr.controller';
import { submitQuizAttempt, getMyAttempts } from '../controllers/quiz.controller';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Legacy CSR course quiz submission
router.post('/:quiz_id/submit',
  authenticate as unknown as RequestHandler,
  submitQuizAnswers as unknown as RequestHandler
);

// Coaching quiz attempts
router.post('/:quizId/attempt',
  authenticate as unknown as RequestHandler,
  submitQuizAttempt as unknown as RequestHandler
);

router.get('/:quizId/attempts',
  authenticate as unknown as RequestHandler,
  getMyAttempts as unknown as RequestHandler
);

export default router;
