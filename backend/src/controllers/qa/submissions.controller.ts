/**
 * Transport handlers for QA submission read / export / finalise endpoints.
 *
 * Preserves the legacy `{ error, message, code }` envelope and per-handler
 * error codes by funnelling through `respond.ts`. All request parsing and
 * pagination clamping happens here; data access is delegated to the
 * `services/qa` modules.
 *
 * Extracted from the old `controllers/qa.controller.ts` (837 lines) during
 * the pre-production review (item #29).
 */

import { Request, Response } from 'express'
import { serviceLogger } from '../../config/logger'
import { getQAPagination } from '../../config/qa.config'
import {
  listCompletedSubmissions,
  getSubmissionDetail,
  buildSubmissionExportCsv,
  finalizeSubmission as finalizeSubmissionService,
} from '../../services/qa'
import { parsePagination } from '../../validation/common'
import { resolvePermittedInternalForms } from '../../utils/formScope'
import { respondWithError } from './respond'

export const getCompletedSubmissions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id
  try {
    serviceLogger.operation('QA', 'getCompletedSubmissions', userId)

    const cfg    = getQAPagination()
    const { page, limit } = parsePagination(req.query, { defaultLimit: cfg.defaultLimit, maxLimit: cfg.maxLimit })
    const formId = req.query.form_id ? parseInt(req.query.form_id as string) : undefined
    const rawStatus = req.query.status as string | undefined
    const status  = rawStatus === 'FINALIZED' || rawStatus === 'DISPUTED' || rawStatus === 'SUBMITTED'
      ? rawStatus
      : undefined

    // QA is author-scoped: they only see audits they submitted. Admin /
    // Manager / Trainer (the other roles with viewAll on quality_submissions)
    // see everyone's. Mirrors the QA dashboard + QA dispute self-scope.
    const submittedBy = req.user?.role === 'QA' ? userId : undefined

    const result = await listCompletedSubmissions({
      page,
      limit,
      formId:    Number.isFinite(formId) ? formId : undefined,
      dateStart: (req.query.date_start as string) || undefined,
      dateEnd:   (req.query.date_end   as string) || undefined,
      status,
      search:    (req.query.search as string) || undefined,
      submittedBy,
    })

    res.status(200).json(result)
  } catch (error) {
    respondWithError(res, 'getCompletedSubmissions', error, {
      message: 'Failed to retrieve completed submissions',
      code:    'QA_SUBMISSIONS_FETCH_ERROR',
    })
  }
}

/**
 * Internal-form audits for the Submissions surface. Unlike `getCompletedSubmissions`
 * (which lists normal audits only), this returns audits captured under an
 * Internal form, restricted to the forms the requester is permitted to see:
 * admin sees all, everyone else sees Internal forms whose audience includes
 * their role or grants their user id. A requester permitted no Internal forms
 * gets an empty list (fail-closed), so the endpoint is safe to call for any
 * viewer of the Submissions page. There is no author self-scope here — the
 * audience, not authorship, governs Internal visibility.
 */
export const getInternalCompletedSubmissions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id
  try {
    serviceLogger.operation('QA', 'getInternalCompletedSubmissions', userId)

    const cfg    = getQAPagination()
    const { page, limit } = parsePagination(req.query, { defaultLimit: cfg.defaultLimit, maxLimit: cfg.maxLimit })
    const formId = req.query.form_id ? parseInt(req.query.form_id as string) : undefined
    const rawStatus = req.query.status as string | undefined
    const status  = rawStatus === 'FINALIZED' || rawStatus === 'DISPUTED' || rawStatus === 'SUBMITTED'
      ? rawStatus
      : undefined

    const { ids } = await resolvePermittedInternalForms(req.user?.role, userId)

    const result = await listCompletedSubmissions({
      page,
      limit,
      formId:    Number.isFinite(formId) ? formId : undefined,
      dateStart: (req.query.date_start as string) || undefined,
      dateEnd:   (req.query.date_end   as string) || undefined,
      status,
      search:    (req.query.search as string) || undefined,
      accessScope: 'INTERNAL',
      permittedInternalFormIds: ids,
    })

    res.status(200).json(result)
  } catch (error) {
    respondWithError(res, 'getInternalCompletedSubmissions', error, {
      message: 'Failed to retrieve internal submissions',
      code:    'QA_INTERNAL_SUBMISSIONS_FETCH_ERROR',
    })
  }
}

export const getSubmissionDetails = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id
  const submissionId = parseInt(req.params.id)
  const includeFullForm = req.query.includeFullForm === 'true'

  try {
    serviceLogger.operation('QA', 'getSubmissionDetails', userId, { submission_id: submissionId, includeFullForm })

    if (isNaN(submissionId)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid submission ID', code: 'INVALID_SUBMISSION_ID' })
      return
    }

    // QA is author-scoped: they can only open audits they submitted. Internal
    // audits ignore author scope and gate on the form audience instead (handled
    // in the service), so a permitted non-author designate can still open them.
    const restrictToSubmittedBy = req.user?.role === 'QA' ? userId : undefined
    const detail = await getSubmissionDetail(submissionId, includeFullForm, restrictToSubmittedBy, {
      requesterRole: req.user?.role,
      requesterUserId: userId,
    })
    res.status(200).json(detail)
  } catch (error) {
    respondWithError(res, 'getSubmissionDetails', error, {
      message: 'Failed to retrieve submission details',
      code:    'QA_SUBMISSION_FETCH_ERROR',
    })
  }
}

export const exportSubmission = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id
  const submissionId = parseInt(req.params.id)

  try {
    serviceLogger.operation('QA', 'exportSubmission', userId, { submission_id: submissionId })

    if (isNaN(submissionId)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid submission ID', code: 'INVALID_SUBMISSION_ID' })
      return
    }

    // QA is author-scoped: they can only export audits they submitted.
    const restrictToSubmittedBy = req.user?.role === 'QA' ? userId : undefined
    const { csv, filename, rowCount } = await buildSubmissionExportCsv(submissionId, restrictToSubmittedBy)
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.status(200).send(csv)

    serviceLogger.operation('QA', 'exportSubmission', userId, { submission_id: submissionId, status: 'success', recordCount: rowCount })
  } catch (error) {
    respondWithError(res, 'exportSubmission', error, {
      message: 'Failed to export submission',
      code:    'QA_EXPORT_ERROR',
    })
  }
}

export const finalizeSubmission = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id
  const submissionId = parseInt(req.params.id)

  try {
    serviceLogger.operation('QA', 'finalizeSubmission', userId, { submission_id: submissionId })

    if (!submissionId || isNaN(submissionId)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Valid submission ID is required', code: 'INVALID_SUBMISSION_ID' })
      return
    }
    if (!userId) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User ID not found', code: 'MISSING_USER_ID' })
      return
    }

    const result = await finalizeSubmissionService(submissionId, userId)
    res.status(200).json({
      message:       'Submission finalized successfully',
      submission_id: result.submission_id,
      status:        result.status,
    })
    serviceLogger.operation('QA', 'finalizeSubmission', userId, { submission_id: submissionId, status: 'success' })
  } catch (error) {
    respondWithError(res, 'finalizeSubmission', error, {
      message: 'Failed to finalize submission',
      code:    'QA_FINALIZE_ERROR',
    })
  }
}
