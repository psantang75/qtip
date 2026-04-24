/**
 * Trainer dashboard transport.
 *
 * Handlers for the four dashboard endpoints:
 *   GET /api/trainer/stats            — `getTrainingStats`
 *   GET /api/trainer/dashboard-stats  — `getTrainerDashboardStats`
 *   GET /api/trainer/csr-activity     — `getTrainerCSRActivity`
 *   GET /api/trainer/team-csrs        — `getTrainerTeamCSRs`
 *
 * Pure transport — extracted from the legacy controller in
 * pre-production review item #29.
 */

import { Request, Response } from 'express'
import {
  getTrainingStats         as svcGetTrainingStats,
  getTrainerDashboardStats as svcGetTrainerDashboardStats,
  getTrainerCSRActivity    as svcGetTrainerCSRActivity,
  getTrainerTeamCSRs       as svcGetTrainerTeamCSRs,
} from '../../services/trainer'
import { respondMessageError } from './respond'

interface AuthenticatedRequest extends Request {
  user?: {
    user_id:        number
    role:           string
    email?:         string
    department_id?: number
  }
}

/** GET /api/trainer/stats */
export const getTrainingStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const trainerId = req.user?.user_id
  if (!trainerId) {
    res.status(401).json({ message: 'Unauthorized: Trainer ID not found' })
    return
  }
  try {
    const stats = await svcGetTrainingStats(trainerId)
    res.status(200).json(stats)
  } catch (error) {
    respondMessageError(res, 'getTrainingStats', error, {
      message: 'Failed to fetch training statistics',
    })
  }
}

/** GET /api/trainer/dashboard-stats */
export const getTrainerDashboardStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = await svcGetTrainerDashboardStats()
    res.status(200).json(stats)
  } catch (error) {
    logger.error('[TRAINER CONTROLLER] Error fetching dashboard stats:', error)
    res.status(500).json({ message: 'Failed to fetch trainer dashboard statistics' })
  }
}

/** GET /api/trainer/csr-activity */
export const getTrainerCSRActivity = async (_req: Request, res: Response): Promise<void> => {
  try {
    const activity = await svcGetTrainerCSRActivity()
    res.status(200).json(activity)
  } catch (error) {
    logger.error('[TRAINER CONTROLLER] Error fetching CSR activity:', error)
    res.status(500).json({ message: 'Failed to fetch CSR activity data' })
  }
}

/** GET /api/trainer/team-csrs */
export const getTrainerTeamCSRs = async (req: AuthenticatedRequest, res: Response) => {
  const trainerId = req.user?.user_id
  if (!trainerId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
  try {
    const csrs = await svcGetTrainerTeamCSRs()
    res.json({ success: true, data: csrs || [] })
  } catch (error) {
    logger.error('Error fetching team CSRs:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

import logger from '../../config/logger';