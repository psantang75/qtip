import express, { RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getInsightsNavigation,
  getInsightsAccess,
  getDataFreshness,
} from '../controllers/insights.controller';
import qcRouter from './insightsQC.routes';

const router = express.Router();

router.get('/navigation',
  authenticate as unknown as RequestHandler,
  getInsightsNavigation as unknown as RequestHandler
);

router.get('/access/:pageKey',
  authenticate as unknown as RequestHandler,
  getInsightsAccess as unknown as RequestHandler
);

router.get('/data-freshness',
  authenticate as unknown as RequestHandler,
  getDataFreshness as unknown as RequestHandler
);

// QC analytics — authenticate applied per-handler (via qcHandler wrapper)
router.use('/qc', authenticate as unknown as RequestHandler, qcRouter as unknown as RequestHandler);

export default router;
