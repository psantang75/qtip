import express from 'express';
import { authenticate, authorizeQA, authorizeQAOrTrainer } from '../middleware/auth';
import {
  getCompletedSubmissions,
  getSubmissionDetails,
  exportSubmission,
  finalizeSubmission,
  getQAStats,
  getQACSRActivity,
} from '../controllers/qa';
import { qaFeatureFlags } from '../config/qa.config';
import { qaCacheService } from '../services/QACacheService';
import prisma from '../config/prisma';

const router = express.Router();

/**
 * QA health probe (no auth — consumed by the uptime monitor).
 *
 * Pre-production review item #98 — we deliberately do **not** echo the
 * backend's feature-flag configuration or per-check error messages in the
 * public response. The payload is just:
 *
 *   { status, timestamp, service, checks: { database, cache, features } }
 *
 * Uptime monitors only need `status` and the per-check booleans to raise
 * alerts. Internal configuration (which cache backend is enabled, which
 * feature flags are on, any driver error text) belongs in the log stream
 * consumed by on-call, not in a public endpoint.
 */
router.get('/health', async (req, res) => {
  const checks = {
    database: false,
    cache: false,
    features: false,
  };

  try {
    await prisma.$executeRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  if (qaFeatureFlags.isCacheEnabled()) {
    try {
      const testKey = 'health_check_test';
      qaCacheService.set(testKey, 'test', 1000);
      checks.cache = qaCacheService.get(testKey) === 'test';
      qaCacheService.delete(testKey);
    } catch {
      checks.cache = false;
    }
  } else {
    checks.cache = true;
  }

  // Feature flags are always considered healthy if the module loaded —
  // the internal config is intentionally not echoed back to the caller.
  checks.features = true;

  const allChecksPass = Object.values(checks).every(Boolean);
  res.status(allChecksPass ? 200 : 503).json({
    status: allChecksPass ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    service: 'QA',
    checks,
  });
});

// All other QA routes require authentication
router.use(authenticate);

// QA Dashboard routes — QA and Admin only
router.get('/stats', authorizeQA, getQAStats);
router.get('/csr-activity', authorizeQA, getQACSRActivity);

// Completed submissions routes — QA, Admin, and Trainer
router.get('/completed', authorizeQAOrTrainer, getCompletedSubmissions);
router.get('/completed/:id', authorizeQAOrTrainer, getSubmissionDetails);
router.get('/completed/:id/export', authorizeQAOrTrainer, exportSubmission);

// Submission management routes — QA and Admin only
router.put('/submissions/:id/finalize', authorizeQA, finalizeSubmission);

export default router;
