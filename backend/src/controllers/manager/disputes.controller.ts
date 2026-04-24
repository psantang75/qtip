/**
 * Manager disputes transport layer.
 *
 * Routes:
 *   GET    /api/manager/disputes
 *   GET    /api/manager/disputes/export
 *   GET    /api/manager/disputes/:disputeId
 *   POST   /api/manager/disputes/:disputeId/resolve
 */
import { Response } from 'express'
import {
  listManagerTeamDisputes,
  exportManagerTeamDisputes,
  getManagerDisputeDetails,
  resolveManagerDispute,
} from '../../services/manager'
import { escapeFilename } from '../../utils/contentDisposition'
import { respondSuccessError, type AuthenticatedRequest } from './respond'

const filtersFromQuery = (req: AuthenticatedRequest) => ({
  status: req.query.status as string | undefined,
  csr_id: req.query.csr_id as string | undefined,
  search: req.query.search as string | undefined,
  formName: req.query.formName as string | undefined,
  form_id: req.query.form_id as string | undefined,
  startDate: req.query.startDate as string | undefined,
  endDate: req.query.endDate as string | undefined,
})

export const listDisputesHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const result = await listManagerTeamDisputes({
      userId,
      userRole: req.user?.role,
      page: parseInt(req.query.page as string) || 1,
      limit: Math.min(5000, parseInt(req.query.limit as string) || 10),
      filters: filtersFromQuery(req),
    })

    res.status(200).json(result)
  } catch (error) {
    respondSuccessError(res, 'listManagerTeamDisputes', error, {
      message: 'Failed to fetch team disputes',
    })
  }
}

export const exportDisputesHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const result = await exportManagerTeamDisputes({
      userId,
      userRole: req.user?.role,
      filters: filtersFromQuery(req),
    })

    res.setHeader('Content-Type', result.mimeType)
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(result.fileName)}`)
    res.send(result.buffer)
  } catch (error) {
    respondSuccessError(res, 'exportManagerTeamDisputes', error, {
      message: 'Failed to export team disputes',
    })
  }
}

export const disputeDetailHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const detail = await getManagerDisputeDetails({
      userId,
      userRole: req.user?.role,
      disputeId: req.params.disputeId,
    })
    res.status(200).json(detail)
  } catch (error) {
    respondSuccessError(res, 'getManagerDisputeDetails', error, {
      message: 'Failed to fetch dispute details',
    })
  }
}

export const resolveDisputeHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }
    const body = req.body ?? {}
    const result = await resolveManagerDispute({
      userId,
      disputeId: req.params.disputeId,
      resolution_action: body.resolution_action,
      resolution_notes: body.resolution_notes,
      new_score: body.new_score,
      answers: body.answers,
      training_id: body.training_id,
    })
    res.status(200).json({ success: true, ...result })
  } catch (error) {
    respondSuccessError(res, 'resolveManagerDispute', error, {
      message: 'Failed to resolve dispute',
    })
  }
}
