/**
 * Read-only writeup endpoints: list, detail, prior-discipline lookup.
 *
 * Transport-only — every line below is request parsing, service dispatch,
 * or response shaping. SQL and visibility rules live in
 * `services/writeups/writeup.list.service.ts` (pre-production review item
 * #29).
 */

import { Response } from 'express'
import {
  AuthReq,
  listWriteUps,
  getWriteUpDetail,
  getPriorDiscipline as fetchPriorDiscipline,
} from '../../services/writeups'
import { respondWithError } from './respond'

/** GET /api/writeups */
export const getWriteUps = async (req: AuthReq, res: Response) => {
  try {
    const result = await listWriteUps({
      viewerId:     req.user!.user_id,
      viewerRole:   req.user!.role,
      page:         Math.max(1, parseInt(req.query.page as string) || 1),
      limit:        Math.min(5000, parseInt(req.query.limit as string) || 20),
      csrId:        req.query.csr_id        ? parseInt(req.query.csr_id as string) : undefined,
      status:       req.query.status        as string | undefined,
      documentType: req.query.document_type as string | undefined,
      dateFrom:     req.query.date_from     as string | undefined,
      dateTo:       req.query.date_to       as string | undefined,
      search:       req.query.search        as string | undefined,
    })
    res.json({ success: true, data: result })
  } catch (error) {
    respondWithError(res, 'getWriteUps', error)
  }
}

/** GET /api/writeups/:id */
export const getWriteUpById = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) {
      return res.status(400).json({ success: false, message: 'Invalid write-up ID' })
    }
    const data = await getWriteUpDetail(writeUpId, req.user!.user_id, req.user!.role)
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'getWriteUpById', error)
  }
}

/** GET /api/writeups/prior-discipline/:csrId */
export const getPriorDiscipline = async (req: AuthReq, res: Response) => {
  try {
    const csrId = parseInt(req.params.csrId)
    if (isNaN(csrId)) {
      return res.status(400).json({ success: false, message: 'Invalid CSR ID' })
    }
    const data = await fetchPriorDiscipline(csrId)
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'getPriorDiscipline', error)
  }
}
