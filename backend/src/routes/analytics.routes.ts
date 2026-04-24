import express, { Request, Response, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { AnalyticsService, AnalyticsServiceError } from '../services/AnalyticsService';
import { MySQLAnalyticsRepository } from '../repositories/MySQLAnalyticsRepository';
import cacheService from '../services/CacheService';

// ─────────────────────────────────────────────────────────────────────────────
// /api/analytics is served exclusively by AnalyticsService (Prisma-based,
// caching, role-aware). The legacy controllers/analytics.controller.ts
// implementation and the USE_NEW_ANALYTICS_SERVICE feature flag were removed
// as part of the pre-production review (item #11) — running two parallel SQL
// implementations behind one URL is a silent data-correctness risk.
// ─────────────────────────────────────────────────────────────────────────────

const router = express.Router();

const analyticsService = new AnalyticsService(new MySQLAnalyticsRepository(), cacheService);

const auth = authenticate as unknown as RequestHandler;

/**
 * Map AnalyticsService errors onto the existing JSON error contract so the
 * frontend (which already handles { message, code }) keeps working.
 */
function sendServiceError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof AnalyticsServiceError) {
    res.status(error.statusCode || 500).json({ message: error.message, code: error.code });
    return;
  }
  const err = error as { statusCode?: number; message?: string; code?: string };
  if (err && typeof err === 'object' && err.statusCode) {
    res.status(err.statusCode).json({ message: err.message ?? fallback, code: err.code });
    return;
  }
  console.error('[ANALYTICS ROUTES]', fallback, error);
  res.status(500).json({ message: fallback });
}

/**
 * @route GET /api/analytics/filters
 * @desc Get filter options for the analytics interface
 * @access Private
 */
router.get('/filters', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.getFilterOptions(req.user!.user_id, req.user!.role);
    res.status(200).json(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to fetch filter options');
  }
});

/**
 * @route POST /api/analytics/qa-score-trends
 * @desc Get QA score trends for visualization
 * @access Private
 */
router.post('/qa-score-trends', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.getQAScoreTrends(req.body, req.user!.user_id, req.user!.role);
    res.status(200).json(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to fetch QA score trends');
  }
});

/**
 * @route POST /api/analytics/qa-score-distribution
 * @desc Get QA score distribution for visualization
 * @access Private
 */
router.post('/qa-score-distribution', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.getQAScoreDistribution(req.body, req.user!.user_id, req.user!.role);
    res.status(200).json(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to fetch QA score distribution');
  }
});

/**
 * @route POST /api/analytics/performance-goals
 * @desc Get performance against goals for visualization
 * @access Private
 */
router.post('/performance-goals', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.getPerformanceGoals(req.body, req.user!.user_id, req.user!.role);
    res.status(200).json(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to calculate performance goals');
  }
});

/**
 * @route POST /api/analytics/export-qa-scores
 * @desc Export QA scores to xlsx
 * @access Private
 */
router.post('/export-qa-scores', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.exportQAScores(req.body, req.user!.user_id, req.user!.role);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="qa-scores.xlsx"');
    res.send(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to export QA scores');
  }
});

/**
 * @route POST /api/analytics/export
 * @desc Export comprehensive analytics data to xlsx
 * @access Private
 */
router.post('/export', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.exportComprehensiveReport(req.body, req.user!.user_id, req.user!.role);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.xlsx"');
    res.send(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to export analytics data');
  }
});

/**
 * @route POST /api/analytics/comprehensive-report
 * @desc Generate comprehensive report for query builder
 * @access Private
 */
router.post('/comprehensive-report', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await analyticsService.getComprehensiveReport(req.body, req.user!.user_id, req.user!.role);
    res.status(200).json(result);
  } catch (error) {
    sendServiceError(res, error, 'Failed to generate comprehensive report');
  }
});

export default router;
