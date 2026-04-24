/**
 * Manager error-mapping helpers.
 *
 * The legacy `controllers/manager.controller.ts` emitted three different
 * error envelopes depending on the endpoint. We preserve all of them so the
 * frontend keeps working unchanged:
 *
 *   `{ success: false, message }`  — disputes / coaching mutations
 *   `{ message }`                  — dashboard / team listings
 *
 * `ManagerServiceError.envelope` selects which shape to emit; controllers
 * choose the appropriate helper based on what their legacy handler returned.
 */
import { Request, Response } from 'express'
import { serviceLogger } from '../../config/logger'
import { ManagerServiceError } from '../../services/manager'

/**
 * Authenticated request shape used by every manager handler.
 *
 * Defined here so each transport file can import a single, consistent type
 * instead of redeclaring the interface (the legacy code did this in every
 * controller, which made keeping the user shape in sync error-prone).
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    user_id: number
    role: string
    email?: string
    department_id?: number
  }
}

/** `{ success: false, message, code? }` envelope used by mutating endpoints. */
export function respondSuccessError(
  res: Response,
  operation: string,
  error: unknown,
  fallback: { message: string },
): Response {
  if (error instanceof ManagerServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    })
  }
  serviceLogger.error('MANAGER', operation, error as Error)
  return res.status(500).json({ success: false, message: fallback.message })
}

/** `{ message, code? }` envelope used by read-only / list endpoints. */
export function respondPlainError(
  res: Response,
  operation: string,
  error: unknown,
  fallback: { message: string },
): Response {
  if (error instanceof ManagerServiceError) {
    return res.status(error.statusCode).json({
      message: error.message,
      code: error.code,
    })
  }
  serviceLogger.error('MANAGER', operation, error as Error)
  return res.status(500).json({ message: fallback.message })
}

/**
 * Pick the right envelope based on the error itself. Useful for endpoints
 * that may throw both shapes (e.g. coaching list emits plain on filter
 * errors but success-shape on validation errors).
 */
export function respondManagerError(
  res: Response,
  operation: string,
  error: unknown,
  fallback: { message: string; envelope?: 'success' | 'plain' },
): Response {
  if (error instanceof ManagerServiceError) {
    if (error.envelope === 'plain') {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
      })
    }
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    })
  }
  serviceLogger.error('MANAGER', operation, error as Error)
  if (fallback.envelope === 'plain') {
    return res.status(500).json({ message: fallback.message })
  }
  return res.status(500).json({ success: false, message: fallback.message })
}
