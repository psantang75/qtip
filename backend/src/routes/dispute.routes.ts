import express, { RequestHandler } from 'express';
import multer from 'multer';
import { 
  getCSRAudits, 
  getAuditDetails, 
  submitDispute, 
  getDisputeHistory,
  getDisputeDetails,
  downloadDisputeAttachment,
  updateDispute
} from '../controllers/dispute.controller';
import { authenticate } from '../middleware/auth';

// Configure multer for dispute file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, './uploads/disputes/');
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document and image types for disputes
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword', // DOC
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
      'image/jpeg',
      'image/jpg',
      'image/png'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, JPEG, PNG files are allowed.'));
    }
  }
});

const router = express.Router();

/**
 * @route GET /api/disputes/audits
 * @desc Get all completed audits for the current CSR
 * @access Private (CSR)
 */
router.get('/audits', 
  authenticate as unknown as RequestHandler, 
  getCSRAudits as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/audit/:submission_id
 * @desc Get details of a specific audit for dispute
 * @access Private (CSR)
 */
router.get('/audit/:submission_id', 
  authenticate as unknown as RequestHandler, 
  getAuditDetails as unknown as RequestHandler
);

/**
 * @route POST /api/disputes
 * @desc Submit a new dispute for an audit
 * @access Private (CSR)
 */
router.post('/', 
  authenticate as unknown as RequestHandler, 
  submitDispute as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/history
 * @desc Get dispute history for the current CSR
 * @access Private (CSR)
 */
router.get('/history', 
  authenticate as unknown as RequestHandler, 
  getDisputeHistory as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/:disputeId/attachment
 * @desc Download dispute attachment
 * @access Private (CSR, QA, Manager, Admin, Trainer)
 */
router.get('/:disputeId/attachment', 
  authenticate as unknown as RequestHandler, 
  downloadDisputeAttachment as unknown as RequestHandler
);

/**
 * @route GET /api/disputes/:disputeId
 * @desc Get details of a specific dispute
 * @access Private (CSR, QA, Manager, Admin)
 */
router.get('/:disputeId', 
  authenticate as unknown as RequestHandler, 
  getDisputeDetails as unknown as RequestHandler
);

/**
 * @route PUT /api/disputes/:disputeId
 * @desc Update a dispute (reason and/or attachment)
 * @access Private (CSR - only for their own OPEN disputes)
 */
router.put('/:disputeId', 
  authenticate as unknown as RequestHandler,
  upload.single('attachment'),
  updateDispute as unknown as RequestHandler
);

export default router; 