import express, { Request, Response, RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { 
  getPerformanceGoals,
  getPerformanceGoalById,
  createPerformanceGoal,
  updatePerformanceGoal,
  deletePerformanceGoal,
  activatePerformanceGoal
} from '../controllers/performanceGoal.controller';
import { useNewPerformanceGoalService } from '../config/features.config';

const router = express.Router();

// New service components (enabled with feature flags)
let performanceGoalService: any = null;

// Initialize new service when feature flag is enabled
if (useNewPerformanceGoalService()) {
  try {
    const { PerformanceGoalService } = require('../services/PerformanceGoalService');
    const { MySQLPerformanceGoalRepository } = require('../repositories/MySQLPerformanceGoalRepository');
    
    const performanceGoalRepository = new MySQLPerformanceGoalRepository();
    performanceGoalService = new PerformanceGoalService(performanceGoalRepository);
    
    console.log('[PERFORMANCE GOAL ROUTES] NEW PerformanceGoalService initialized');
  } catch (error) {
    console.error('[PERFORMANCE GOAL ROUTES] Failed to initialize new service:', error);
  }
}

/**
 * Wrapper function for get performance goals with feature flag support
 */
const getPerformanceGoalsWrapper = async (req: Request, res: Response): Promise<void> => {
  console.log('[PERFORMANCE GOAL ROUTES] Request received:', req.url);
  console.log('[PERFORMANCE GOAL ROUTES] Query params:', req.query);
  
  if (useNewPerformanceGoalService() && performanceGoalService) {
    console.log('[PERFORMANCE GOAL ROUTES] Using NEW PerformanceGoalService for get goals');
    
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 10;
      
      const filters: any = {};
      if (req.query.goal_type) filters.goal_type = req.query.goal_type;
      if (req.query.department_id) filters.department_id = parseInt(req.query.department_id as string);
      if (req.query.is_active !== undefined) filters.is_active = req.query.is_active === 'true';
      if (req.query.scope) filters.scope = req.query.scope;

      console.log('[PERFORMANCE GOAL ROUTES] Calling service with params:', { page, pageSize, filters });

      const result = await performanceGoalService.getPerformanceGoals(page, pageSize, filters);
      
      console.log('[PERFORMANCE GOAL ROUTES] Service returned successfully');
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[PERFORMANCE GOAL ROUTES] New service error:', error);
      console.error('[PERFORMANCE GOAL ROUTES] Error stack:', error.stack);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to fetch performance goals' });
      }
    }
  } else {
    console.log('[PERFORMANCE GOAL ROUTES] Using OLD Controller for get goals');
    console.log('[PERFORMANCE GOAL ROUTES] Feature flag enabled:', useNewPerformanceGoalService());
    console.log('[PERFORMANCE GOAL ROUTES] Service initialized:', !!performanceGoalService);
    return getPerformanceGoals(req, res);
  }
};

/**
 * Wrapper function for get performance goal by ID with feature flag support
 */
const getPerformanceGoalByIdWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewPerformanceGoalService() && performanceGoalService) {
    console.log('[PERFORMANCE GOAL ROUTES] Using NEW PerformanceGoalService for get goal by ID');
    
    try {
      const id = parseInt(req.params.id);
      const result = await performanceGoalService.getPerformanceGoalById(id);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[PERFORMANCE GOAL ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to fetch performance goal' });
      }
    }
  } else {
    console.log('[PERFORMANCE GOAL ROUTES] Using OLD Controller for get goal by ID');
    return getPerformanceGoalById(req, res);
  }
};

/**
 * Wrapper function for create performance goal with feature flag support
 */
const createPerformanceGoalWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewPerformanceGoalService() && performanceGoalService) {
    console.log('[PERFORMANCE GOAL ROUTES] Using NEW PerformanceGoalService for create goal');
    
    try {
      const user = req.user;
      const goalData = req.body;
      const result = await performanceGoalService.createPerformanceGoal(goalData, user.user_id);
      res.status(201).json(result);
    } catch (error: any) {
      console.error('[PERFORMANCE GOAL ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to create performance goal' });
      }
    }
  } else {
    console.log('[PERFORMANCE GOAL ROUTES] Using OLD Controller for create goal');
    return createPerformanceGoal(req, res);
  }
};

/**
 * Wrapper function for update performance goal with feature flag support
 */
const updatePerformanceGoalWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewPerformanceGoalService() && performanceGoalService) {
    console.log('[PERFORMANCE GOAL ROUTES] Using NEW PerformanceGoalService for update goal');
    
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      const goalData = req.body;
      const result = await performanceGoalService.updatePerformanceGoal(id, goalData, user.user_id);
      res.status(200).json(result);
    } catch (error: any) {
      console.error('[PERFORMANCE GOAL ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to update performance goal' });
      }
    }
  } else {
    console.log('[PERFORMANCE GOAL ROUTES] Using OLD Controller for update goal');
    return updatePerformanceGoal(req, res);
  }
};

/**
 * Wrapper function for delete performance goal with feature flag support
 */
const deletePerformanceGoalWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewPerformanceGoalService() && performanceGoalService) {
    console.log('[PERFORMANCE GOAL ROUTES] Using NEW PerformanceGoalService for delete goal');
    
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      await performanceGoalService.deletePerformanceGoal(id, user.user_id);
      res.status(200).json({ message: 'Performance goal deleted successfully' });
    } catch (error: any) {
      console.error('[PERFORMANCE GOAL ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to delete performance goal' });
      }
    }
  } else {
    console.log('[PERFORMANCE GOAL ROUTES] Using OLD Controller for delete goal');
    return deletePerformanceGoal(req, res);
  }
};

/**
 * Wrapper function for activate performance goal with feature flag support
 */
const activatePerformanceGoalWrapper = async (req: Request, res: Response): Promise<void> => {
  if (useNewPerformanceGoalService() && performanceGoalService) {
    console.log('[PERFORMANCE GOAL ROUTES] Using NEW PerformanceGoalService for activate goal');
    
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      await performanceGoalService.activatePerformanceGoal(id, user.user_id);
      res.status(200).json({ message: 'Performance goal activated successfully' });
    } catch (error: any) {
      console.error('[PERFORMANCE GOAL ROUTES] New service error:', error);
      if (error.statusCode) {
        res.status(error.statusCode).json({ message: error.message, code: error.code });
      } else {
        res.status(500).json({ message: 'Failed to activate performance goal' });
      }
    }
  } else {
    console.log('[PERFORMANCE GOAL ROUTES] Using OLD Controller for activate goal');
    return activatePerformanceGoal(req, res);
  }
};

/**
 * @route GET /api/performance-goals
 * @desc Get all performance goals with pagination and filtering
 * @access Public (for testing)
 */
router.get('/', getPerformanceGoalsWrapper as unknown as RequestHandler);

/**
 * @route GET /api/performance-goals/:id
 * @desc Get a single performance goal by ID
 * @access Private
 */
router.get('/:id', 
  authenticate as unknown as RequestHandler, 
  getPerformanceGoalByIdWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/performance-goals
 * @desc Create a new performance goal
 * @access Private (Admin only)
 */
router.post('/', 
  authenticate as unknown as RequestHandler, 
  authorizeAdmin as unknown as RequestHandler, 
  createPerformanceGoalWrapper as unknown as RequestHandler
);

/**
 * @route PUT /api/performance-goals/:id
 * @desc Update a performance goal
 * @access Private (Admin only)
 */
router.put('/:id', 
  authenticate as unknown as RequestHandler, 
  authorizeAdmin as unknown as RequestHandler, 
  updatePerformanceGoalWrapper as unknown as RequestHandler
);

/**
 * @route DELETE /api/performance-goals/:id
 * @desc Delete (deactivate) a performance goal
 * @access Private (Admin only)
 */
router.delete('/:id', 
  authenticate as unknown as RequestHandler, 
  authorizeAdmin as unknown as RequestHandler, 
  deletePerformanceGoalWrapper as unknown as RequestHandler
);

/**
 * @route POST /api/performance-goals/:id/activate
 * @desc Activate a performance goal
 * @access Private (Admin only)
 */
router.post('/:id/activate', 
  authenticate as unknown as RequestHandler, 
  authorizeAdmin as unknown as RequestHandler, 
  activatePerformanceGoalWrapper as unknown as RequestHandler
);

export default router; 