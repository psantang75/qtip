/**
 * Coaching session attachment helpers:
 *   - `saveCoachingAttachment`: persists an in-memory multer upload to
 *     `uploads/coaching/<rand>.<ext>` and returns the metadata that should be
 *     written into `coaching_sessions.attachment_*`.
 *   - `getDownloadableAttachment`: looks up an attachment for the given
 *     session id, verifies the file exists on disk, and returns the headers +
 *     readable stream the controller should pipe to the client.
 *
 * Centralising these means the create / update / download handlers all share
 * one filename convention, one mime list, and one disk layout.
 */
import { promises as fs, createReadStream } from 'fs'
import path from 'path'
import type { ReadStream } from 'fs'
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { serviceLogger } from '../../config/logger'
import { getCsrRoleId } from './manager.access'
import { ManagerServiceError } from './manager.types'

export interface CoachingAttachmentMeta {
  filename: string | null
  path: string | null
  size: number | null
  mime_type: string | null
}

const EMPTY_ATTACHMENT: CoachingAttachmentMeta = {
  filename: null,
  path: null,
  size: null,
  mime_type: null,
}

/** Generates a unique on-disk filename based on timestamp + random tail. */
function generateStoredFilename(originalName: string): string {
  const timestamp = Date.now()
  const fileExtension = path.extname(originalName)
  const random = Math.random().toString(36).substring(2, 15)
  return `coaching_${timestamp}_${random}${fileExtension}`
}

/**
 * @returns Metadata to insert into `coaching_sessions`. If `file` is undefined
 *          returns the empty placeholder (caller can leave columns null).
 */
export async function saveCoachingAttachment(
  file: Express.Multer.File | undefined,
): Promise<CoachingAttachmentMeta> {
  if (!file) return EMPTY_ATTACHMENT

  const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching')
  try {
    await fs.mkdir(uploadsDir, { recursive: true })
  } catch (err) {
    serviceLogger.error('MANAGER', 'Error creating uploads directory:', err as Error)
  }

  const storedName = generateStoredFilename(file.originalname)
  const filePath = path.join(uploadsDir, storedName)

  try {
    await fs.writeFile(filePath, file.buffer)
  } catch (err) {
    serviceLogger.error('MANAGER', 'Error saving coaching attachment:', err as Error)
    throw new ManagerServiceError('Failed to save attachment', 500, 'ATTACHMENT_SAVE_FAILED')
  }

  return {
    filename: file.originalname,
    path: `uploads/coaching/${storedName}`,
    size: file.size,
    mime_type: file.mimetype,
  }
}

export interface DownloadableAttachment {
  filename: string
  mimeType: string
  size: number
  stream: ReadStream
}

/**
 * Resolves the on-disk attachment for a coaching session and returns a stream
 * the controller can pipe to the response. Throws `ManagerServiceError` if
 * the session, attachment, or backing file is missing.
 */
export async function getDownloadableAttachment(
  sessionId: number,
): Promise<DownloadableAttachment> {
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    throw new ManagerServiceError('Invalid session ID', 400, 'INVALID_SESSION_ID')
  }

  const csrRoleId = await getCsrRoleId()

  const sessionRows = await prisma.$queryRaw<Array<{
    attachment_filename: string | null
    attachment_path: string | null
    attachment_mime_type: string | null
  }>>(Prisma.sql`
    SELECT cs.id, cs.attachment_filename, cs.attachment_path, cs.attachment_mime_type
    FROM coaching_sessions cs
    JOIN users u ON cs.csr_id = u.id
    JOIN departments d ON u.department_id = d.id
    WHERE cs.id = ${sessionId}
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
      AND cs.attachment_path IS NOT NULL
  `)

  if (sessionRows.length === 0 || !sessionRows[0].attachment_path) {
    throw new ManagerServiceError(
      'Coaching session not found or no attachment',
      404,
      'NOT_FOUND',
    )
  }

  const session = sessionRows[0]
  const filePath = path.join(process.cwd(), session.attachment_path!)

  try {
    await fs.access(filePath)
  } catch {
    throw new ManagerServiceError(
      'Attachment file not found on server',
      404,
      'FILE_MISSING',
    )
  }

  const stats = await fs.stat(filePath)

  return {
    filename: session.attachment_filename ?? 'attachment',
    mimeType: session.attachment_mime_type ?? 'application/octet-stream',
    size: stats.size,
    stream: createReadStream(filePath),
  }
}
