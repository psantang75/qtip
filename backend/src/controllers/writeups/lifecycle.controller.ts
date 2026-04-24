/**
 * Writeup write endpoints: create / update / notes / status / sign / follow-up.
 *
 * Transport-only — every line below is request parsing, service dispatch,
 * or response shaping. Validation, permission gates, and the status-machine
 * transition matrix live in `services/writeups/writeup.lifecycle.service.ts`
 * and `services/writeups/writeup.transition.service.ts` (pre-production
 * review item #29).
 */

import { Response } from 'express'
import {
  AuthReq,
  createWriteUp as createWriteUpService,
  updateWriteUp as updateWriteUpService,
  updateInternalNotes as updateInternalNotesService,
  updateFollowUpNotes as updateFollowUpNotesService,
  transitionStatus as transitionStatusService,
  signWriteUp as signWriteUpService,
  setFollowUp as setFollowUpService,
} from '../../services/writeups'
import { respondWithError } from './respond'

const requireWriteUpId = (raw: string, res: Response): number | null => {
  const id = parseInt(raw)
  if (isNaN(id)) {
    res.status(400).json({ success: false, message: 'Invalid write-up ID' })
    return null
  }
  return id
}

/** POST /api/writeups */
export const createWriteUp = async (req: AuthReq, res: Response) => {
  try {
    const result = await createWriteUpService(req.body, req.user!.user_id)
    res.status(201).json({ success: true, data: result })
  } catch (error) {
    respondWithError(res, 'createWriteUp', error)
  }
}

/** PUT /api/writeups/:id */
export const updateWriteUp = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = requireWriteUpId(req.params.id, res)
    if (writeUpId === null) return
    await updateWriteUpService(writeUpId, req.body, req.user!.user_id, req.user!.role)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, 'updateWriteUp', error)
  }
}

/** PATCH /api/writeups/:id/internal-notes */
export const updateInternalNotes = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = requireWriteUpId(req.params.id, res)
    if (writeUpId === null) return
    await updateInternalNotesService(writeUpId, req.body)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, 'updateInternalNotes', error)
  }
}

/** PATCH /api/writeups/:id/follow-up-notes */
export const updateFollowUpNotes = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = requireWriteUpId(req.params.id, res)
    if (writeUpId === null) return
    await updateFollowUpNotesService(writeUpId, req.body?.follow_up_notes)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, 'updateFollowUpNotes', error)
  }
}

/** PATCH /api/writeups/:id/status */
export const transitionStatus = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = requireWriteUpId(req.params.id, res)
    if (writeUpId === null) return
    const data = await transitionStatusService(writeUpId, req.body, req.user!.role)
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'transitionStatus', error)
  }
}

/** POST /api/writeups/:id/sign */
export const signWriteUp = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = requireWriteUpId(req.params.id, res)
    if (writeUpId === null) return
    const clientIp = String(req.ip || req.headers['x-forwarded-for'] || 'unknown')
    const data = await signWriteUpService(
      writeUpId,
      { signature_data: req.body?.signature_data, clientIp },
      req.user!.user_id,
      req.user!.role,
    )
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'signWriteUp', error)
  }
}

/** PATCH /api/writeups/:id/follow-up */
export const setFollowUp = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = requireWriteUpId(req.params.id, res)
    if (writeUpId === null) return
    await setFollowUpService(writeUpId, req.body)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, 'setFollowUp', error)
  }
}
