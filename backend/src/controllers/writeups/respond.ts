/**
 * Tiny error-mapping helper shared by every writeup controller.
 *
 * Translates `WriteUpServiceError` into the documented JSON envelope
 * `{ success: false, message }` at the requested status code, and falls
 * back to a 500 with a redacted message for anything else. Lives next to
 * the controllers (not in `utils/`) because it encodes the writeups
 * response contract — the rest of the codebase uses the global error
 * handler in `utils/errorHandler.ts`, but writeups already shipped their
 * own envelope and we are doing a structural refactor only (item #29 in
 * the pre-production review, no behavioural changes).
 */

import { Response } from 'express'
import { WriteUpServiceError } from '../../services/writeups'

export function respondWithError(res: Response, label: string, error: unknown): Response {
  if (error instanceof WriteUpServiceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message })
  }
  console.error(`[WRITEUP] ${label} error:`, error)
  return res.status(500).json({ success: false, message: 'Internal server error' })
}
