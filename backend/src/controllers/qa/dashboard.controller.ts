/**
 * Transport handlers for the QA dashboard endpoints.
 *
 * `getQAStats` is cache-aware (the service decides whether to hit the
 * QACacheService); the controller logs the data source for ops visibility.
 *
 * Extracted from the old `controllers/qa.controller.ts` during the
 * pre-production review (item #29).
 */

import { Request, Response } from 'express'
import { serviceLogger } from '../../config/logger'
import {
  getQAStats as getQAStatsService,
  getQACSRActivity as getQACSRActivityService,
} from '../../services/qa'
import { respondWithError } from './respond'

export const getQAStats = async (req: Request, res: Response): Promise<void> => {
  const qaUserId = req.user?.user_id

  if (!qaUserId) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'User ID not found', code: 'MISSING_USER_ID' })
    return
  }

  try {
    serviceLogger.operation('QA', 'getQAStats', qaUserId)
    const { stats, source } = await getQAStatsService(qaUserId)
    serviceLogger.operation('QA', 'getQAStats', qaUserId, { source })
    res.status(200).json(stats)
  } catch (error) {
    respondWithError(res, 'getQAStats', error, {
      message: 'Failed to fetch QA dashboard statistics',
      code:    'QA_STATS_ERROR',
    })
  }
}

export const getQACSRActivity = async (req: Request, res: Response): Promise<void> => {
  const qaUserId = req.user?.user_id

  try {
    serviceLogger.operation('QA', 'getQACSRActivity', qaUserId)

    if (!qaUserId) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User ID not found', code: 'MISSING_USER_ID' })
      return
    }

    const rows = await getQACSRActivityService(qaUserId)
    res.status(200).json(rows)
    serviceLogger.operation('QA', 'getQACSRActivity', qaUserId, { csrCount: rows.length, status: 'success' })
  } catch (error) {
    respondWithError(res, 'getQACSRActivity', error, {
      message: 'Failed to fetch QA CSR activity data',
      code:    'QA_CSR_ACTIVITY_ERROR',
    })
  }
}
