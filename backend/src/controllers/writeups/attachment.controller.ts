/**
 * Writeup attachment endpoints: upload, download, delete.
 *
 * Transport-only — every line below either parses the request, calls the
 * service, sets headers, or pipes the file stream. The actual db row + file
 * I/O lives in `services/writeups/writeup.attachment.service.ts`. The
 * download handler keeps `fs.createReadStream(absPath).pipe(res)` here
 * because the stream owns the response — moving it into the service would
 * pull `res` into a layer that should not know about transport
 * (pre-production review item #29).
 */

import { Response } from 'express'
import { createReadStream } from 'fs'
import {
  AuthReq,
  createAttachment,
  resolveAttachmentForDownload,
  deleteAttachment as deleteAttachmentService,
} from '../../services/writeups'
import { respondWithError } from './respond'

const requirePair = (idRaw: string, attachmentIdRaw: string, res: Response): { writeUpId: number; attachmentId: number } | null => {
  const writeUpId    = parseInt(idRaw)
  const attachmentId = parseInt(attachmentIdRaw)
  if (isNaN(writeUpId) || isNaN(attachmentId)) {
    res.status(400).json({ success: false, message: 'Invalid ID' })
    return null
  }
  return { writeUpId, attachmentId }
}

/** POST /api/writeups/:id/attachments */
export const uploadAttachment = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) {
      return res.status(400).json({ success: false, message: 'Invalid write-up ID' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = (req as any).file
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' })

    const data = await createAttachment(writeUpId, file)
    res.status(201).json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'uploadAttachment', error)
  }
}

/** GET /api/writeups/:id/attachments/:attachmentId */
export const downloadAttachment = async (req: AuthReq, res: Response) => {
  try {
    const ids = requirePair(req.params.id, req.params.attachmentId, res)
    if (ids === null) return
    const { filename, mime, absPath } = await resolveAttachmentForDownload(ids.writeUpId, ids.attachmentId)

    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`)
    createReadStream(absPath).pipe(res)
  } catch (error) {
    respondWithError(res, 'downloadAttachment', error)
  }
}

/** DELETE /api/writeups/:id/attachments/:attachmentId */
export const deleteAttachment = async (req: AuthReq, res: Response) => {
  try {
    const ids = requirePair(req.params.id, req.params.attachmentId, res)
    if (ids === null) return
    await deleteAttachmentService(ids.writeUpId, ids.attachmentId)
    res.json({ success: true })
  } catch (error) {
    respondWithError(res, 'deleteAttachment', error)
  }
}
