/**
 * Trainer error-mapping helpers.
 *
 * The legacy `controllers/trainer.controller.ts` shipped two distinct
 * error envelopes — different endpoints have different schemas already
 * baked into their clients. We keep both shapes intact and centralise
 * only the `TrainerServiceError → HTTP` translation so the new transport
 * controllers stay thin.
 *
 * Shapes preserved:
 *   `{ message, code }`             — training-stats endpoint
 *   `{ error, message, code }`      — submission-detail endpoint
 *
 * Created during the pre-production review (item #29).
 */

import { Response } from 'express'
import { serviceLogger } from '../../config/logger'
import { TrainerServiceError } from '../../services/trainer'

/**
 * `{ message, code }` envelope. Used by the training-stats endpoint —
 * the surface that originally lived at the bottom of the legacy
 * controller's `getTrainingStats` handler.
 */
export function respondMessageError(
  res:       Response,
  operation: string,
  error:     unknown,
  fallback:  { message: string },
): Response {
  if (error instanceof TrainerServiceError) {
    return res.status(error.statusCode).json({
      message: error.message,
      code:    error.code,
    })
  }
  serviceLogger.error('TRAINER', operation, error as Error)
  return res.status(500).json({ message: fallback.message })
}

/**
 * `{ error, message, code }` envelope. Used by the submission-detail
 * endpoint, which derives the `error` tag from the HTTP status so
 * existing clients keep getting `NOT_FOUND` / `BAD_REQUEST` /
 * `DATABASE_ERROR` strings.
 */
export function respondDetailedError(
  res:       Response,
  operation: string,
  error:     unknown,
  fallback:  { error: string; message: string; code: string },
): Response {
  if (error instanceof TrainerServiceError) {
    return res.status(error.statusCode).json({
      error:   tagFromStatus(error.statusCode),
      message: error.message,
      code:    error.code,
    })
  }
  serviceLogger.error('TRAINER', operation, error as Error)
  return res.status(500).json({
    error:   fallback.error,
    message: fallback.message,
    code:    fallback.code,
  })
}

function tagFromStatus(status: number): string {
  if (status === 400) return 'BAD_REQUEST'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  return 'INTERNAL_SERVER_ERROR'
}
