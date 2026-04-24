/**
 * Shared types for the QA service domain.
 *
 * Extracted from the old `controllers/qa.controller.ts` (837 lines) during
 * the pre-production review (item #29). Kept in one file so all QA service
 * modules and controllers import a single source of truth for the
 * structured error class and the request-shape DTOs.
 *
 * Error envelope: QA endpoints already shipped `{ error, message, code }`
 * (different from the writeup `{ success, message }` shape). The QA
 * controller `respond.ts` translates `QAServiceError` into that envelope so
 * the existing API contract is preserved.
 */

/**
 * Errors thrown by QA services. Mirrors `WriteUpServiceError` but carries
 * the QA-specific `errorTag` and `code` fields the existing API surfaces
 * (the legacy controller hand-built these per-handler — now centralised).
 */
export class QAServiceError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly errorTag: string

  constructor(message: string, statusCode = 500, code = 'QA_ERROR', errorTag = 'INTERNAL_SERVER_ERROR') {
    super(message)
    this.name = 'QAServiceError'
    this.statusCode = statusCode
    this.code = code
    this.errorTag = errorTag
  }
}

/** Filters accepted by the completed-submissions list endpoint. */
export interface CompletedSubmissionsParams {
  page: number
  limit: number
  formId?: number
  dateStart?: string
  dateEnd?: string
  status?: 'FINALIZED' | 'DISPUTED' | 'SUBMITTED'
  search?: string
}

export interface CompletedSubmissionsResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

/** Pre-baked dashboard counts (week + month) for a single QA user. */
export interface QAStatsResult {
  reviewsCompleted: { thisWeek: number; thisMonth: number }
  disputes:        { thisWeek: number; thisMonth: number }
}

/** Per-CSR audit and dispute roll-up surfaced by the QA dashboard grid. */
export interface QACSRActivityRow {
  id: number
  name: string
  department: string
  audits: number
  disputes: number
  audits_week: number
  disputes_week: number
  audits_month: number
  disputes_month: number
}
