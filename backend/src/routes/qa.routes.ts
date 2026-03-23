import express from 'express';
import { authenticate, authorizeQA } from '../middleware/auth';
// Rate limiting imports removed - rate limiting disabled
// import { lenientRateLimit, standardRateLimit, strictRateLimit } from '../middleware/rateLimiter';
import { 
  getCompletedSubmissions, 
  getSubmissionDetails,
  exportSubmission,
  finalizeSubmission,
  getQAStats,
  getQACSRActivity
} from '../controllers/qa.controller';
import { qaFeatureFlags } from '../config/qa.config';
import { qaCacheService } from '../services/QACacheService';
import prisma from '../config/prisma';

const router = express.Router();

// QA Health check endpoint (no auth required for monitoring)
router.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'QA',
      checks: {
        database: false,
        cache: false,
        features: false
      },
      details: {} as any
    };

    // Database connectivity check
    try {
      await prisma.$executeRaw`SELECT 1`;
      healthStatus.checks.database = true;
    } catch (error) {
      healthStatus.checks.database = false;
      healthStatus.details.database = 'Connection failed';
    }

    // Cache service check (if enabled)
    if (qaFeatureFlags.isCacheEnabled()) {
      try {
        const testKey = 'health_check_test';
        qaCacheService.set(testKey, 'test', 1000);
        const testValue = qaCacheService.get(testKey);
        healthStatus.checks.cache = testValue === 'test';
        qaCacheService.delete(testKey);
      } catch (error) {
        healthStatus.checks.cache = false;
        healthStatus.details.cache = 'Cache operation failed';
      }
    } else {
      healthStatus.checks.cache = true; // Consider healthy if disabled
    }

    // Feature flags check
    healthStatus.checks.features = true;
    healthStatus.details.features = {
      cacheEnabled: qaFeatureFlags.isCacheEnabled(),
      metricsEnabled: qaFeatureFlags.isMetricsEnabled(),
      healthChecksEnabled: qaFeatureFlags.isHealthChecksEnabled()
    };

    // Overall health status
    const allChecksPass = Object.values(healthStatus.checks).every(check => check === true);
    healthStatus.status = allChecksPass ? 'healthy' : 'unhealthy';

    res.status(allChecksPass ? 200 : 503).json(healthStatus);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'QA',
      error: 'Health check failed'
    });
  }
});

// All other QA routes require authentication and QA role authorization
router.use(authenticate);
router.use(authorizeQA);

// QA Dashboard routes - rate limiting DISABLED
router.get('/stats', getQAStats);
router.get('/csr-activity', getQACSRActivity);

// Completed submissions routes - rate limiting DISABLED
router.get('/completed', getCompletedSubmissions);
router.get('/completed/:id', getSubmissionDetails);
router.get('/completed/:id/export', exportSubmission);

// Submission management routes - rate limiting DISABLED
router.put('/submissions/:id/finalize', finalizeSubmission);

export default router;
