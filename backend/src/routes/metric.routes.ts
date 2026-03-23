import { Router, RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import {
  getAllMetricsHandler,
  getMetricByIdHandler,
  createMetricHandler,
  updateMetricHandler,
  setThresholdHandler,
  getThresholdsHandler,
} from '../controllers/metricController';

const router = Router();

// GET /api/metrics — all authenticated users
router.get('/',
  authenticate as unknown as RequestHandler,
  getAllMetricsHandler as unknown as RequestHandler,
);

// GET /api/metrics/:id — all authenticated users
router.get('/:id',
  authenticate as unknown as RequestHandler,
  getMetricByIdHandler as unknown as RequestHandler,
);

// POST /api/metrics — admin only
router.post('/',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  createMetricHandler as unknown as RequestHandler,
);

// PUT /api/metrics/:id — admin only
router.put('/:id',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  updateMetricHandler as unknown as RequestHandler,
);

// GET /api/metrics/:id/thresholds — all authenticated users
router.get('/:id/thresholds',
  authenticate as unknown as RequestHandler,
  getThresholdsHandler as unknown as RequestHandler,
);

// POST /api/metrics/:id/thresholds — admin only
router.post('/:id/thresholds',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  setThresholdHandler as unknown as RequestHandler,
);

export default router;
