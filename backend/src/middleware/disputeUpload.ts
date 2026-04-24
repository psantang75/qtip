import multer from 'multer';
import path from 'path';

/**
 * Shared multer configuration for dispute attachments.
 *
 * Mounted on:
 *   - POST /api/csr/disputes              (csr.routes.ts)
 *   - PUT  /api/disputes/:disputeId       (dispute.routes.ts)
 *
 * Storage:
 *   ./uploads/disputes/{fieldname}-{timestamp}-{rand}.{ext}
 *   - The original filename is intentionally NOT preserved on disk to avoid
 *     storing user-controlled characters in the filesystem path. The display
 *     filename (if needed) should be persisted alongside the record.
 *
 * Limits:
 *   - 5 MB per file.
 *
 * Allowed mime types:
 *   PDF, DOC, DOCX, JPG/JPEG, PNG.
 *
 * Anything outside this list is rejected with a 400-friendly error message.
 *
 * Centralised here so the two upload entry points can never drift apart
 * (they previously had two near-identical inline copies — see pre-production
 * review item #14).
 */

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword', // DOC
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'image/jpeg',
  'image/jpg',
  'image/png'
] as const;

export const DISPUTE_UPLOAD_DIR = './uploads/disputes/';
export const DISPUTE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const disputeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, DISPUTE_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
  }),
  limits: {
    fileSize: DISPUTE_UPLOAD_MAX_BYTES
  },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, JPEG, PNG files are allowed.'));
    }
  }
});

export default disputeUpload;
