/**
 * Manager team-audits transport layer.
 *
 * Routes:
 *   GET /api/manager/team-audits        — paginated list with filters
 *   GET /api/manager/team-audits/:id    — detailed view of a single audit
 */
import { Response } from 'express'
import {
  listManagerTeamAudits,
  getManagerTeamAuditDetails,
} from '../../services/manager'
import { respondPlainError, type AuthenticatedRequest } from './respond'

export const teamAuditsListHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }

    const result = await listManagerTeamAudits({
      userId,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
      filters: {
        search: req.query.search as string | undefined,
        csr_id: req.query.csr_id as string | undefined,
        form_id_search: req.query.form_id_search as string | undefined,
        form_id: req.query.form_id as string | undefined,
        form_name: req.query.form_name as string | undefined,
        status: req.query.status as string | undefined,
        dispute_status: req.query.dispute_status as string | undefined,
        start_date: req.query.start_date as string | undefined,
        end_date: req.query.end_date as string | undefined,
      },
    })

    res.status(200).json(result)
  } catch (error) {
    respondPlainError(res, 'listManagerTeamAudits', error, {
      message: 'Failed to fetch filtered team audits',
    })
  }
}

export const teamAuditDetailHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const submissionId = parseInt(req.params.id, 10)
    const detail = await getManagerTeamAuditDetails({
      userId,
      userRole: req.user?.role,
      submissionId,
    })
    res.status(200).json(detail)
  } catch (error) {
    respondPlainError(res, 'getManagerTeamAuditDetails', error, {
      message: 'Failed to fetch audit details',
    })
  }
}
