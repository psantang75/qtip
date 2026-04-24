/**
 * POST /api/writeups/coaching-session — create a coaching session that the
 * writeup form can subsequently link to.
 *
 * Transport-only — every line below is request parsing, service dispatch,
 * or response shaping. Domain logic lives in
 * `services/writeups/writeup.linkedCoaching.service.ts` (pre-production
 * review item #29).
 */

import { Response } from 'express'
import { AuthReq, createLinkedCoachingSession as createLinkedCoachingSessionService } from '../../services/writeups'
import { respondWithError } from './respond'

export const createLinkedCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const data = await createLinkedCoachingSessionService(req.body, req.user!.user_id)
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'createLinkedCoachingSession', error)
  }
}
