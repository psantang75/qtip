/**
 * Manager dashboard transport layer.
 *
 * Routes:
 *   GET /api/manager/stats           (alias)
 *   GET /api/manager/dashboard-stats
 *   GET /api/manager/csr-activity
 *
 * Each handler is a thin shell that pulls user context off the request,
 * delegates to the dashboard service, and forwards the response. Errors are
 * mapped through `respondPlainError` because the legacy endpoints used the
 * `{ message }` envelope (no `success` field).
 */
import { Response } from 'express'
import {
  getManagerDashboardStats,
  getManagerCSRActivity,
} from '../../services/manager'
import { respondPlainError, type AuthenticatedRequest } from './respond'

export const dashboardStatsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const stats = await getManagerDashboardStats(userId)
    res.status(200).json(stats)
  } catch (error) {
    respondPlainError(res, 'getManagerDashboardStats', error, {
      message: 'Failed to fetch manager dashboard statistics',
    })
  }
}

export const csrActivityHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    const userRole = req.user?.role
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const activity = await getManagerCSRActivity(userId, userRole)
    res.status(200).json(activity)
  } catch (error) {
    respondPlainError(res, 'getManagerCSRActivity', error, {
      message: 'Failed to fetch CSR activity data',
    })
  }
}
