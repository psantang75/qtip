import multer from 'multer';

/**
 * Shared multer configuration for coaching session attachments.
 *
 * Mounted on (manager domain):
 *   - POST /api/manager/coaching-sessions
 *   - PUT  /api/manager/coaching-sessions/:sessionId
 *
 * Storage:
 *   In-memory buffer. The file is persisted to `uploads/coaching/` by
 *   `manager.coaching.attachment.service.ts` after validation, so the upload
 *   middleware itself never touches the filesystem.
 *
 * Limits:
 *   - 5 MB per file.
 *
 * Allowed mime types:
 *   PDF, Word (DOC/DOCX), Excel (XLS/XLSX), plain text, JPEG/PNG/GIF.
 *
 * Centralising this here keeps `routes/manager.routes.ts` thin and means
 * the policy can never drift if another mount point is added later.
 */

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
] as const;

export const COACHING_UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const coachingUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: COACHING_UPLOAD_MAX_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only PDF, Word, Excel, text, and image files are allowed.',
        ),
      );
    }
  },
});

export default coachingUpload;
