/**
 * Trainer health-check transport.
 *
 * Handler for `GET /api/trainer/health`. Returns 200 when every probe
 * passes, 503 otherwise — same status mapping the legacy controller
 * shipped, so existing load-balancer probes don't break.
 */

import { Request, Response } from 'express'
import { getTrainerHealthReport } from '../../services/trainer'

export const getTrainerHealthCheck = async (_req: Request, res: Response): Promise<void> => {
  try {
    const report     = await getTrainerHealthReport()
    const statusCode = report.status === 'healthy' ? 200 : 503
    res.status(statusCode).json(report)
  } catch (error) {
    logger.error('[TRAINER HEALTH] Health check failed:', error)
    res.status(503).json({
      status:    'unhealthy',
      timestamp: new Date().toISOString(),
      service:   'TRAINER',
      error:     'Health check failed',
    })
  }
}

import logger from '../../config/logger';