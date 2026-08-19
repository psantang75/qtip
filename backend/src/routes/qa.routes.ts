import express from 'express';
import { authenticate, authorizePage } from '../middleware/auth';
import type { RequestHandler } from 'express';
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
import { validateSchema } from '../validation/csr.validation';
import { QaCompletedListQuerySchema } from '../validation/listFilters.validation';

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

// Page-access gates sourced from `app_page_role_access` (see migration
// 20260625070000_add_quality_app_pages). All endpoints below back the
// Quality > Submissions surface, so they share the `quality_submissions`
// key. Read vs write follows the semantic of the action.
const submissionsRead  = authorizePage('quality_submissions', 'viewAll') as unknown as RequestHandler;
const submissionsWrite = authorizePage('quality_submissions', 'edit')    as unknown as RequestHandler;

// QA dashboard widgets — same surface as the submissions list.
router.get('/stats',                       submissionsRead,  getQAStats);
router.get('/csr-activity',                submissionsRead,  getQACSRActivity);

// Editor submission listings (used by the Submissions page).
router.get('/completed',                   submissionsRead,  validateSchema(QaCompletedListQuerySchema), getCompletedSubmissions);
router.get('/completed/:id',               submissionsRead,  getSubmissionDetails);
router.get('/completed/:id/export',        submissionsRead,  exportSubmission);

// Submission state transitions — full write required.
router.put('/submissions/:id/finalize',    submissionsWrite, finalizeSubmission);

export default router;
