/**
 * Writeup attachment service: db row creation + file resolution + cleanup.
 *
 * Owns the database side of attachments and the multer-uploaded file
 * lifecycle. The download path returns the resolved absolute path + the
 * mime/filename headers so the controller can stream the file with
 * `fs.createReadStream(...).pipe(res)` — that's the only piece of the
 * download that has to live in the transport layer because it touches
 * `res` directly.
 *
 * Extracted from the old `controllers/writeup.controller.ts` during the
 * pre-production review (item #29).
 */

import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import prisma from '../../config/prisma'
import { WriteUpServiceError } from './writeup.types'

export interface UploadedFileMeta {
  originalname: string
  path?: string
  size?: number
  mimetype?: string
}

export interface ResolvedAttachment {
  filename: string
  mime: string
  absPath: string
}

/** Persist a multer-uploaded file as a write-up attachment row. */
export async function createAttachment(writeUpId: number, file: UploadedFileMeta): Promise<{ id: number }> {
  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')

  const attachment = await prisma.writeUpAttachment.create({
    data: {
      write_up_id:     writeUpId,
      attachment_type: 'UPLOAD',
      filename:        file.originalname,
      file_path:       file.path ?? null,
      file_size:       file.size ?? null,
      mime_type:       file.mimetype ?? null,
    },
  })

  return { id: attachment.id }
}

/**
 * Resolve an attachment for download. Verifies the row exists, that it is
 * scoped to the supplied write-up id, and that the underlying file is still
 * present on disk. Throws `WRITEUP_NOT_FOUND` for any miss so the caller
 * surfaces a 404 (no info leak about which step failed).
 */
export async function resolveAttachmentForDownload(writeUpId: number, attachmentId: number): Promise<ResolvedAttachment> {
  const attachment = await prisma.writeUpAttachment.findFirst({
    where: { id: attachmentId, write_up_id: writeUpId },
  })
  if (!attachment) throw new WriteUpServiceError('Attachment not found', 404, 'WRITEUP_NOT_FOUND')
  if (!attachment.file_path) throw new WriteUpServiceError('File not available', 404, 'WRITEUP_NOT_FOUND')

  const absPath = path.resolve(attachment.file_path)
  if (!existsSync(absPath)) {
    throw new WriteUpServiceError('File not found on disk', 404, 'WRITEUP_NOT_FOUND')
  }

  return {
    filename: attachment.filename,
    mime:     attachment.mime_type ?? 'application/octet-stream',
    absPath,
  }
}

/**
 * Remove an attachment row and best-effort delete the file on disk. A
 * missing file is logged as recoverable and does not fail the deletion of
 * the row (the file may have been swept already).
 */
export async function deleteAttachment(writeUpId: number, attachmentId: number): Promise<void> {
  const attachment = await prisma.writeUpAttachment.findFirst({
    where: { id: attachmentId, write_up_id: writeUpId },
  })
  if (!attachment) throw new WriteUpServiceError('Attachment not found', 404, 'WRITEUP_NOT_FOUND')

  await prisma.writeUpAttachment.delete({ where: { id: attachmentId } })

  if (attachment.file_path) {
    try { await unlink(attachment.file_path) } catch { /* file may already be gone */ }
  }
}
