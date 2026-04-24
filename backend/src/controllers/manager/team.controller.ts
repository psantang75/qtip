/**
 * Manager team-roster transport layer.
 *
 * GET /api/manager/team-csrs — returns the list of CSRs in the manager's
 * department(s) for filter dropdowns. Response shape: `{ data, total }`.
 */
import { Response } from 'express'
import { listManagerTeamCsrs } from '../../services/manager'
import { respondPlainError, type AuthenticatedRequest } from './respond'

export const teamCsrsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.user_id
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const result = await listManagerTeamCsrs(userId)
    res.status(200).json(result)
  } catch (error) {
    respondPlainError(res, 'listManagerTeamCsrs', error, {
      message: 'Failed to fetch team CSRs',
    })
  }
}
