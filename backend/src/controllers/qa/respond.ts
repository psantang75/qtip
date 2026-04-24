/**
 * QA error-mapping helper.
 *
 * Translates `QAServiceError` into the QA API envelope
 * `{ error, message, code }` (note: this is a different shape from the
 * writeup `{ success, message }` envelope — kept separate per domain to
 * preserve the existing API contract during the structural-only refactor
 * in pre-production review item #29).
 *
 * Falls back to a 500 with a redacted message and the supplied default
 * `code` for unknown errors so server-side stack traces don't leak.
 */

import { Response } from 'express'
import { serviceLogger } from '../../config/logger'
import { QAServiceError } from '../../services/qa'

export function respondWithError(
  res: Response,
  operation: string,
  error: unknown,
  fallback: { message: string; code: string },
): Response {
  if (error instanceof QAServiceError) {
    return res.status(error.statusCode).json({
      error:   error.errorTag,
      message: error.message,
      code:    error.code,
    })
  }

  serviceLogger.error('QA', operation, error as Error)
  return res.status(500).json({
    error:   'INTERNAL_SERVER_ERROR',
    message: fallback.message,
    code:    fallback.code,
  })
}
