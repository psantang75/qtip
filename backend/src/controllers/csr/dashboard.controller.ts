import { Request, Response } from 'express';
import { CSRRepository } from '../../repositories/CSRRepository';
import { asyncHandler, createAuthorizationError } from '../../utils/errorHandler';

/**
 * CSR dashboard handlers — `/api/csr/{stats, dashboard-stats, csr-activity}`.
 *
 * One of three transport modules under `controllers/csr/` (consolidated
 * during pre-production review item #69 from the old `csrDashboard`,
 * `csrAudit`, and `csr` controllers). Re-exported via `./index`.
 */

/**
 * Get CSR dashboard statistics (filtered to logged-in CSR only)
 * @route GET /api/csr/dashboard-stats
 */
export const getCSRDashboardStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const csr_id = req.user?.user_id;
  
  if (!csr_id) {
    throw createAuthorizationError('Unauthorized access', { endpoint: 'dashboard-stats' });
  }

  const stats = await CSRRepository.getDashboardStats(csr_id);
  res.status(200).json(stats);
});

/**
 * Get CSR activity data for CSR dashboard (only logged-in CSR's data)
 * @route GET /api/csr/csr-activity
 */
export const getCSRActivity = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const csr_id = req.user?.user_id;
  
  if (!csr_id) {
    throw createAuthorizationError('Unauthorized access', { endpoint: 'csr-activity' });
  }

  const activity = await CSRRepository.getCSRActivity(csr_id);
  res.status(200).json(activity);
});

/**
 * Get CSR dashboard statistics (legacy endpoint)
 * @route GET /api/csr/stats
 */
export const getCSRStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const csr_id = req.user?.user_id;
  
  if (!csr_id) {
    throw createAuthorizationError('Unauthorized access', { endpoint: 'stats' });
  }

  // Get QA stats and training stats in parallel
  const [qaStats, trainingStats] = await Promise.all([
    CSRRepository.getCSRQAStats(csr_id),
    CSRRepository.getCSRTrainingStats(csr_id)
  ]);

  // Default goals
  const qaScoreTarget = 90;
  const trainingCompletionTarget = 100;

  const response = {
    stats: {
      qaScore: {
        score: Math.round(qaStats.avgScore),
        total: qaStats.totalAudits
      },
      goalProgress: {
        qaScore: {
          current: Math.round(qaStats.avgScore),
          target: qaScoreTarget
        },
        trainingCompletion: {
          current: trainingStats.assigned > 0 
            ? Math.round((trainingStats.completed / trainingStats.assigned) * 100) 
            : 0,
          target: trainingCompletionTarget
        }
      },
      trainingStatus: {
        completed: trainingStats.completed,
        assigned: trainingStats.assigned
      }
    }
  };

  res.status(200).json(response);
}); 