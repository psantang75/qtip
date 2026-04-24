/**
 * Manager coaching-sessions transport layer.
 *
 * Routes:
 *   GET    /api/manager/coaching-sessions
 *   GET    /api/manager/coaching-sessions/export
 *   GET    /api/manager/coaching-sessions/:sessionId
 *   GET    /api/manager/coaching-sessions/:sessionId/attachment
 *   POST   /api/manager/coaching-sessions
 *   PUT    /api/manager/coaching-sessions/:sessionId
 *   PATCH  /api/manager/coaching-sessions/:sessionId/complete
 *   PATCH  /api/manager/coaching-sessions/:sessionId/reopen
 *
 * Every handler stays thin: parse + delegate + format. All responses use the
 * `{ success, data | message }` envelope the frontend expects.
 */
import { Response } from 'express'
import {
  listManagerCoachingSessions,
  exportManagerCoachingSessions,
  getManagerCoachingSessionDetails,
  createManagerCoachingSession,
  updateManagerCoachingSession,
  completeManagerCoachingSession,
  reopenManagerCoachingSession,
  getDownloadableAttachment,
} from '../../services/manager'
import { escapeFilename } from '../../utils/contentDisposition'
import { respondSuccessError, type AuthenticatedRequest } from './respond'

const filtersFromQuery = (req: AuthenticatedRequest) => ({
  search: (req.query.search as string) || undefined,
  csr_id: (req.query.csr_id as string) || undefined,
  status: (req.query.status as string) || undefined,
  coaching_type: (req.query.coaching_type as string) || undefined,
  startDate: (req.query.startDate as string) || undefined,
  endDate: (req.query.endDate as string) || undefined,
})

export const listCoachingHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const result = await listManagerCoachingSessions({
      userId,
      userRole: req.user?.role,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 10,
      filters: filtersFromQuery(req),
    })
    res.status(200).json({ success: true, data: result })
  } catch (error) {
    respondSuccessError(res, 'listManagerCoachingSessions', error, {
      message: 'Failed to fetch coaching sessions',
    })
  }
}

export const exportCoachingHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const result = await exportManagerCoachingSessions({
      userId,
      userRole: req.user?.role,
      filters: filtersFromQuery(req),
    })
    res.setHeader('Content-Type', result.mimeType)
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(result.fileName)}`)
    res.send(result.buffer)
  } catch (error) {
    respondSuccessError(res, 'exportManagerCoachingSessions', error, {
      message: 'Failed to export coaching sessions',
    })
  }
}

export const coachingDetailHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const detail = await getManagerCoachingSessionDetails({
      userId,
      userRole: req.user?.role,
      sessionId: parseInt(req.params.sessionId, 10),
    })
    res.status(200).json({ success: true, data: detail })
  } catch (error) {
    respondSuccessError(res, 'getManagerCoachingSessionDetails', error, {
      message: 'Failed to fetch coaching session',
    })
  }
}

export const createCoachingHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const session = await createManagerCoachingSession({
      managerId: userId,
      userRole: req.user?.role,
      body: req.body,
      attachment: req.file,
    })
    res.status(201).json({ success: true, data: session })
  } catch (error) {
    respondSuccessError(res, 'createManagerCoachingSession', error, {
      message: 'Failed to create coaching session',
    })
  }
}

export const updateCoachingHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const session = await updateManagerCoachingSession({
      userId,
      userRole: req.user?.role,
      sessionId: parseInt(req.params.sessionId, 10),
      body: req.body,
      attachment: req.file,
    })
    res.status(200).json({ success: true, data: session })
  } catch (error) {
    respondSuccessError(res, 'updateManagerCoachingSession', error, {
      message: 'Failed to update coaching session',
    })
  }
}

export const completeCoachingHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const session = await completeManagerCoachingSession({
      userId,
      userRole: req.user?.role,
      sessionId: parseInt(req.params.sessionId, 10),
    })
    res.status(200).json({ success: true, data: session })
  } catch (error) {
    respondSuccessError(res, 'completeManagerCoachingSession', error, {
      message: 'Failed to complete coaching session',
    })
  }
}

export const reopenCoachingHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const session = await reopenManagerCoachingSession({
      userId,
      userRole: req.user?.role,
      sessionId: parseInt(req.params.sessionId, 10),
    })
    res.status(200).json({ success: true, data: session })
  } catch (error) {
    respondSuccessError(res, 'reopenManagerCoachingSession', error, {
      message: 'Failed to reopen coaching session',
    })
  }
}

export const downloadCoachingAttachmentHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const result = await getDownloadableAttachment(parseInt(req.params.sessionId, 10))
    res.setHeader('Content-Type', result.mimeType)
    res.setHeader('Content-Length', String(result.size))
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(result.filename)}`)
    result.stream.pipe(res)
  } catch (error) {
    respondSuccessError(res, 'downloadCoachingAttachment', error, {
      message: 'Failed to download attachment',
    })
  }
}
