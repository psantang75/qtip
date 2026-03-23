import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { authenticate, authorizeAdmin, authorizeManager } from '../middleware/auth';
import {
  uploadImport,
  previewImportHandler,
  getImportHistory,
  getImportById,
} from '../controllers/importController';

const router = Router();

// Memory-based storage — buffers are passed to service layer directly
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are accepted'));
    }
  },
});

// Preview — Admin or Manager can preview before committing
router.post(
  '/preview',
  authenticate as unknown as RequestHandler,
  authorizeManager as unknown as RequestHandler,
  upload.single('file'),
  previewImportHandler as unknown as RequestHandler,
);

// Upload / execute import — Admin or Manager
router.post(
  '/upload',
  authenticate as unknown as RequestHandler,
  authorizeManager as unknown as RequestHandler,
  upload.single('file'),
  uploadImport as unknown as RequestHandler,
);

// Import history — Admin only
router.get(
  '/history',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getImportHistory as unknown as RequestHandler,
);

// Single import log by ID — Admin only
router.get(
  '/:id',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getImportById as unknown as RequestHandler,
);

export default router;
