/**
 * Shared types for the writeups domain.
 *
 * Extracted from the old `controllers/writeup.controller.ts` (915 lines) and
 * `services/writeup.service.ts` (97 lines, inverted ratio) during the
 * pre-production review (item #29). Kept in one file so all writeup modules
 * import a single source of truth for the auth shape, the input DTOs, and
 * the structured service-error class controllers map to HTTP statuses.
 */

import { Request } from 'express'

/**
 * Authenticated request shape used by every writeup controller. The auth
 * middleware populates `req.user`; controllers assume it is present (the
 * route is mounted behind `authenticate`).
 */
export interface AuthReq extends Request {
  user?: { user_id: number; role: string }
}

/** Single example row inside a violation. */
export interface ExampleInput {
  example_date?: string
  description: string
  source?: string
  qa_submission_id?: number
  qa_question_id?: number
  sort_order?: number
}

/** Single policy violation row inside an incident. */
export interface ViolationInput {
  policy_violated: string
  reference_material?: string
  sort_order?: number
  examples?: ExampleInput[]
}

/** Top-level incident with nested violations and examples. */
export interface IncidentInput {
  description: string
  sort_order?: number
  violations?: ViolationInput[]
}

/** Reference to a prior write-up or coaching session. */
export interface PriorDisciplineRef {
  reference_type: 'write_up' | 'coaching_session'
  reference_id: number | string
}

/**
 * Errors thrown by writeup services so controllers can map them onto HTTP
 * statuses without leaking domain logic into the transport layer.
 *
 * Mirror the existing pattern (`UserServiceError`, `AnalyticsServiceError`,
 * `TrainerServiceError`). The global `errorHandler` in
 * `utils/errorHandler.ts` doesn't special-case this class yet, so each
 * controller catches it explicitly and renders the documented JSON envelope
 * `{ success: false, message }` to preserve the existing API contract.
 */
export class WriteUpServiceError extends Error {
  public readonly statusCode: number
  public readonly code: string

  constructor(message: string, statusCode = 500, code = 'WRITEUP_ERROR') {
    super(message)
    this.name = 'WriteUpServiceError'
    this.statusCode = statusCode
    this.code = code
  }
}
