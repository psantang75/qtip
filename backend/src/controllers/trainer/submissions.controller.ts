/**
 * Trainer completed-submissions transport.
 *
 * Handlers for:
 *   GET /api/trainer/completed       — paginated list (default 1000)
 *   GET /api/trainer/completed/:id   — single-submission detail with
 *                                      optional form-structure expansion
 *
 * Pure transport — extracted from the legacy controller in
 * pre-production review item #29. Logging via `trainerLogger` is
 * preserved to keep dashboards/alerts intact.
 */

import { Request, Response } from 'express'
import { trainerLogger } from '../../services/TrainerLogger'
import {
  listTrainerCompletedSubmissions,
  getTrainerSubmissionDetail,
} from '../../services/trainer'
import { respondDetailedError } from './respond'

export const getTrainerCompletedSubmissions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id

  try {
    trainerLogger.operation('getCompletedSubmissions', userId)

    const page   = Math.max(1,    parseInt(req.query.page  as string) || 1)
    const limit  = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 1000))
    const formId = req.query.form_id ? parseInt(req.query.form_id as string) : null

    const result = await listTrainerCompletedSubmissions({
      page,
      limit,
      formId,
      dateStart: req.query.date_start as string,
      dateEnd:   req.query.date_end   as string,
      status:    req.query.status     as string,
      search:    req.query.search     as string,
    })

    res.status(200).json(result)
  } catch (error) {
    console.error('[TRAINER] Error fetching completed submissions:', error)
    trainerLogger.operationError('getCompletedSubmissions', error as Error, userId)
    res.status(500).json({
      message: 'Failed to fetch completed submissions',
      error:   process.env.NODE_ENV === 'development' ? String(error) : undefined,
    })
  }
}

export const getTrainerSubmissionDetails = async (req: Request, res: Response): Promise<void> => {
  const userId                = req.user?.user_id
  const submissionId          = parseInt(req.params.id)
  const includeScores         = req.query.includeScores         === 'true'
  const includeQuestionScores = req.query.includeQuestionScores === 'true'
  const includeScoreDetails   = req.query.includeScoreDetails   === 'true'

  if (isNaN(submissionId)) {
    res.status(400).json({
      error:   'BAD_REQUEST',
      message: 'Invalid submission ID',
      code:    'INVALID_SUBMISSION_ID',
    })
    return
  }

  try {
    trainerLogger.operation('getSubmissionDetails', userId, {
      submissionId, includeScores, includeQuestionScores, includeScoreDetails,
    })

    const detail = await getTrainerSubmissionDetail(
      submissionId,
      { includeScores, includeQuestionScores, includeScoreDetails },
      userId,
    )

    res.status(200).json(detail)
  } catch (error) {
    trainerLogger.operationError('getSubmissionDetails', error as Error, userId, { submissionId })
    respondDetailedError(res, 'getSubmissionDetails', error, {
      error:   'DATABASE_ERROR',
      message: 'Failed to fetch submission details',
      code:    'TRAINER_SUBMISSION_DB_ERROR',
    })
  }
}
