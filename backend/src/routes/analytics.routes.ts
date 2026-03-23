import express, { Request, Response, RequestHandler } from 'express';
import { 
  getFilterOptions,
  getQAScoreTrends,
  getQAScoreDistribution,
  getPerformanceGoals,
  exportQAScores
} from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';
import { useNewAnalyticsService } from '../config/features.config';

const router = express.Router();

// New service components (will be enabled with feature flags)
let analyticsService: any = null;

// Initialize new service when feature flag is enabled
if (useNewAnalyticsService()) {
  try {
    const { AnalyticsService } = require('../services/AnalyticsService');
    const { MySQLAnalyticsRepository } = require('../repositories/MySQLAnalyticsRepository');
    const cacheService = require('../services/CacheService').default;
    
    const analyticsRepository = new MySQLAnalyticsRepository();
    analyticsService = new AnalyticsService(analyticsRepository, cacheService);
    
    console.log('[ANALYTICS ROUTES] NEW Analytics Service initialized');
  } catch (error) {
    console.error('[ANALYTICS ROUTES] Failed to initialize new service:', error);
  }
}

/**
 * Wrapper function for filter options with feature flag support
 */
const getFilterOptionsWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for filter options');
    
    try {
      const user = (req as any).user;
      const result = await analyticsService.getFilterOptions(user.user_id, user.role);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to fetch filter options' });
      }
    }
  } else {
    console.log('[ANALYTICS ROUTES] Using OLD Analytics Controller for filter options');
    return getFilterOptions(req, res);
  }
};

/**
 * Wrapper function for QA score trends with feature flag support
 */
const getQAScoreTrendsWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for QA score trends');
    
    try {
      const filters = req.body;
      const user = (req as any).user;
      const result = await analyticsService.getQAScoreTrends(filters, user.user_id, user.role);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to fetch QA score trends' });
      }
    }
  } else {
    console.log('[ANALYTICS ROUTES] Using OLD Analytics Controller for QA score trends');
    return getQAScoreTrends(req, res);
  }
};

/**
 * Wrapper function for QA score distribution with feature flag support
 */
const getQAScoreDistributionWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for QA score distribution');
    
    try {
      const filters = req.body;
      const user = (req as any).user;
      const result = await analyticsService.getQAScoreDistribution(filters, user.user_id, user.role);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to fetch QA score distribution' });
      }
    }
  } else {
    console.log('[ANALYTICS ROUTES] Using OLD Analytics Controller for QA score distribution');
    return getQAScoreDistribution(req, res);
  }
};

/**
 * Wrapper function for performance goals with feature flag support
 */
const getPerformanceGoalsWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for performance goals');
    
    try {
      const filters = req.body;
      const user = (req as any).user;
      const result = await analyticsService.getPerformanceGoals(filters, user.user_id, user.role);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to calculate performance goals' });
      }
    }
  } else {
    console.log('[ANALYTICS ROUTES] Using OLD Analytics Controller for performance goals');
    return getPerformanceGoals(req, res);
  }
};

/**
 * Wrapper function for QA scores export with feature flag support
 */
const exportQAScoresWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for QA scores export');
    try {
      const filters = req.body;
      const user = (req as any).user;
      const result = await analyticsService.exportQAScores(filters, user.user_id, user.role);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="qa-scores.xlsx"');
      res.send(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to export QA scores' });
      }
    }
  } else {
    console.log('[ANALYTICS ROUTES] Using OLD Analytics Controller for QA scores export');
    return exportQAScores(req, res);
  }
};

/**
 * Wrapper function for analytics export with feature flag support
 */
const exportAnalyticsWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for analytics export');
    try {
      const filters = req.body;
      const user = (req as any).user;
      const result = await analyticsService.exportComprehensiveReport(filters, user.user_id, user.role);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.xlsx"');
      res.send(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to export analytics data' });
      }
    }
  } else {
    console.log('[ANALYTICS ROUTES] Using OLD Analytics Controller for analytics export');
    return exportQAScores(req, res);
  }
};

/**
 * Wrapper function for comprehensive reporting with feature flag support
 */
const getComprehensiveReportWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewAnalyticsService() && analyticsService) {
    console.log('[ANALYTICS ROUTES] Using NEW Analytics Service for comprehensive report');
    
    try {
      const filters = req.body;
      const user = (req as any).user;
      const result = await analyticsService.getComprehensiveReport(filters, user.user_id, user.role);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[ANALYTICS ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to generate comprehensive report' });
      }
    }
  } else {
    // Fallback for when new service is not available
    console.log('[ANALYTICS ROUTES] Comprehensive reporting requires NEW Analytics Service');
    res.status(503).json({ 
      message: 'Comprehensive reporting service not available', 
      code: 'SERVICE_UNAVAILABLE' 
    });
  }
};

/**
 * @route GET /api/analytics/filters
 * @desc Get filter options for the analytics interface
 * @access Private
 */
router.get('/filters', 
  authenticate as unknown as RequestHandler, 
  getFilterOptionsWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/analytics/qa-score-trends
 * @desc Get QA score trends for visualization
 * @access Private
 */
router.post('/qa-score-trends', 
  authenticate as unknown as RequestHandler, 
  getQAScoreTrendsWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/analytics/qa-score-distribution
 * @desc Get QA score distribution for visualization
 * @access Private
 */
router.post('/qa-score-distribution', 
  authenticate as unknown as RequestHandler, 
  getQAScoreDistributionWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/analytics/performance-goals
 * @desc Get performance against goals for visualization
 * @access Private
 */
router.post('/performance-goals', 
  authenticate as unknown as RequestHandler, 
  getPerformanceGoalsWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/analytics/export-qa-scores
 * @desc Export QA scores for CSV/PDF
 * @access Private
 */
router.post('/export-qa-scores', 
  authenticate as unknown as RequestHandler, 
  exportQAScoresWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/analytics/export
 * @desc Export analytics data for CSV/PDF
 * @access Private
 */
router.post('/export', 
  authenticate as unknown as RequestHandler, 
  exportAnalyticsWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/analytics/comprehensive-report
 * @desc Generate comprehensive report for query builder
 * @access Private
 */
router.post('/comprehensive-report', 
  authenticate as unknown as RequestHandler, 
  getComprehensiveReportWrapper as unknown as RequestHandler
);

export default router; 