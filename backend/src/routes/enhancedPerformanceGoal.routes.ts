import express, { Request, Response, RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { EnhancedPerformanceGoalService } from '../services/EnhancedPerformanceGoalService';
import {
  CreatePerformanceGoalData,
  UpdatePerformanceGoalData,
  PerformanceGoalFilters,
  PerformanceGoalServiceError,
  type goal_type,
  type GoalScope,
  type target_scope,
} from '../types/performanceGoal.types';

const router = express.Router();
const performanceGoalService = new EnhancedPerformanceGoalService();

const auth = authenticate as unknown as RequestHandler;
const adminOnly = authorizeAdmin as unknown as RequestHandler;

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT — route ordering
//
// Express matches the first registered route that fits. All routes that share
// the `/:id` shape (e.g. GET /:id, POST /:id/activate) MUST be declared after
// any literal-prefix routes (/user/..., /options/..., /reports/...) — otherwise
// requests like GET /user/42/active match `/:id` first and parseInt("user")
// returns NaN. See pre-production review item #8.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Collection ─────────────────────────────────────────────────────────────

/**
 * @route GET /api/enhanced-performance-goals
 * @desc Get all performance goals with enhanced filtering and pagination
 * @access Private (Admin/Manager)
 */
router.get('/', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;

    const filters: PerformanceGoalFilters = {};

    if (req.query.goal_type) filters.goal_type = req.query.goal_type as goal_type;
    if (req.query.scope) filters.scope = req.query.scope as GoalScope;
    if (req.query.target_scope) filters.target_scope = req.query.target_scope as target_scope;
    if (req.query.is_active !== undefined) filters.is_active = req.query.is_active === 'true';
    if (req.query.start_date) filters.start_date = req.query.start_date as string;
    if (req.query.end_date) filters.end_date = req.query.end_date as string;
    if (req.query.user_id) filters.user_id = parseInt(req.query.user_id as string);
    if (req.query.department_id) filters.department_id = parseInt(req.query.department_id as string);
    if (req.query.form_id) filters.form_id = parseInt(req.query.form_id as string);
    if (req.query.search) filters.search = req.query.search as string;

    const result = await performanceGoalService.getPerformanceGoals(page, pageSize, filters);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error getting goals:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to fetch performance goals' });
    }
  }
});

/**
 * @route POST /api/enhanced-performance-goals
 * @desc Create a new performance goal
 * @access Private (Admin only)
 */
router.post('/', auth, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const goalData: CreatePerformanceGoalData = req.body;
    const result = await performanceGoalService.createPerformanceGoal(goalData, req.user!.user_id);
    res.status(201).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error creating goal:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to create performance goal' });
    }
  }
});

// ─── Literal-prefix routes (MUST come before /:id) ──────────────────────────

/**
 * @route GET /api/enhanced-performance-goals/user/:user_id/active
 * @desc Get active goals for a specific user
 * @access Private
 */
router.get('/user/:user_id/active', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user_id = parseInt(req.params.user_id);
    const asOfDate = req.query.asOfDate as string;
    const result = await performanceGoalService.getActiveGoalsForUser(user_id, asOfDate);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error getting user goals:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to fetch user goals' });
    }
  }
});

/**
 * @route GET /api/enhanced-performance-goals/options/forms
 * @desc Get form options for targeting
 * @access Private (Admin)
 */
router.get('/options/forms', auth, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await performanceGoalService.getFormOptions();
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error getting form options:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to fetch form options' });
    }
  }
});

/**
 * @route GET /api/enhanced-performance-goals/options/users
 * @desc Get users for assignment
 * @access Private (Admin)
 */
router.get('/options/users', auth, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const department_id = req.query.department_id ? parseInt(req.query.department_id as string) : undefined;
    const result = await performanceGoalService.getUsersForAssignment(department_id);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error getting users for assignment:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  }
});

/**
 * @route GET /api/enhanced-performance-goals/options/departments
 * @desc Get departments for assignment
 * @access Private (Admin)
 */
router.get('/options/departments', auth, adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await performanceGoalService.getDepartmentsForAssignment();
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error getting departments for assignment:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to fetch departments' });
    }
  }
});

/**
 * @route POST /api/enhanced-performance-goals/reports/performance
 * @desc Calculate performance against goals
 * @access Private
 */
router.post('/reports/performance', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = req.body;
    const result = await performanceGoalService.calculatePerformanceReport(filters);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error calculating performance report:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to calculate performance report' });
    }
  }
});

// ─── /:id routes (MUST come after all literal-prefix routes) ────────────────

/**
 * @route GET /api/enhanced-performance-goals/:id
 * @desc Get performance goal by ID
 * @access Private (Admin/Manager)
 */
router.get('/:id', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const result = await performanceGoalService.getPerformanceGoalById(id);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error getting goal by ID:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to fetch performance goal' });
    }
  }
});

/**
 * @route PUT /api/enhanced-performance-goals/:id
 * @desc Update a performance goal
 * @access Private (Admin only)
 */
router.put('/:id', auth, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const updates: UpdatePerformanceGoalData = req.body;
    const result = await performanceGoalService.updatePerformanceGoal(id, updates, req.user!.user_id);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error updating goal:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to update performance goal' });
    }
  }
});

/**
 * @route DELETE /api/enhanced-performance-goals/:id
 * @desc Delete (deactivate) a performance goal
 * @access Private (Admin only)
 */
router.delete('/:id', auth, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await performanceGoalService.deletePerformanceGoal(id, req.user!.user_id);
    res.status(200).json({ message: 'Performance goal deleted successfully' });
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error deleting goal:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to delete performance goal' });
    }
  }
});

/**
 * @route POST /api/enhanced-performance-goals/:id/activate
 * @desc Activate a performance goal
 * @access Private (Admin only)
 */
router.post('/:id/activate', auth, adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await performanceGoalService.activatePerformanceGoal(id, req.user!.user_id);
    res.status(200).json({ message: 'Performance goal activated successfully' });
  } catch (error: any) {
    console.error('[ENHANCED PERF GOAL ROUTES] Error activating goal:', error);
    if (error instanceof PerformanceGoalServiceError) {
      res.status(error.statusCode).json({ message: error.message, code: error.code });
    } else {
      res.status(500).json({ message: 'Failed to activate performance goal' });
    }
  }
});

export default router;
