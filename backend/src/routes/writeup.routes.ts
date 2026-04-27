import { Router, RequestHandler } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate, authorizeManager } from '../middleware/auth'
import { validateSchema } from '../validation/csr.validation'
import { CreateWriteUpSchema, UpdateWriteUpSchema } from '../validation/writeup.validation'
import {
  getWriteUps,
  getWriteUpById,
  createWriteUp,
  updateWriteUp,
  updateInternalNotes,
  updateFollowUpNotes,
  transitionStatus,
  signWriteUp,
  setFollowUp,
  searchQaRecords,
  searchCoachingSessions,
  getPriorDiscipline,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  createLinkedCoachingSession,
} from '../controllers/writeups'

const uploadDir = path.resolve('./uploads/writeups')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename:    (_req, file, cb) => {
      const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
      cb(null, `${suffix}-${file.originalname}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg', 'image/jpg', 'image/png',
    ]
    cb(null, allowed.includes(file.mimetype))
  },
})

const router = Router()
router.use(authenticate as unknown as RequestHandler)

// Read-only routes — all authenticated users (CSRs see only their own via controller)
router.get('/',                        getWriteUps                                                                                                              as unknown as RequestHandler)
router.get('/qa-search',               searchQaRecords                                                                                                          as unknown as RequestHandler)
router.get('/coaching-search',         searchCoachingSessions                                                                                                   as unknown as RequestHandler)
router.get('/prior-discipline/:csrId', getPriorDiscipline                                                                                                       as unknown as RequestHandler)
router.get('/:id',                     getWriteUpById                                                                                                           as unknown as RequestHandler)
router.get('/:id/attachments/:attachmentId',                                                                                             downloadAttachment      as unknown as RequestHandler)

// Write routes — Manager, Admin, QA only (Trainer intentionally excluded;
// see file header on `services/writeups/writeup.lifecycle.service.ts` for
// the rationale — pre-production review item #90).
router.post('/',                       authorizeManager as unknown as RequestHandler, validateSchema(CreateWriteUpSchema), createWriteUp                         as unknown as RequestHandler)
router.post('/coaching-session',       authorizeManager as unknown as RequestHandler, createLinkedCoachingSession                                                as unknown as RequestHandler)
router.put('/:id',                     authorizeManager as unknown as RequestHandler, validateSchema(UpdateWriteUpSchema), updateWriteUp                         as unknown as RequestHandler)
router.patch('/:id/internal-notes',    authorizeManager as unknown as RequestHandler, updateInternalNotes                                                        as unknown as RequestHandler)
router.patch('/:id/follow-up-notes',   authorizeManager as unknown as RequestHandler, updateFollowUpNotes                                                        as unknown as RequestHandler)
router.patch('/:id/status',            authorizeManager as unknown as RequestHandler, transitionStatus                                                           as unknown as RequestHandler)
router.patch('/:id/follow-up',         authorizeManager as unknown as RequestHandler, setFollowUp                                                                as unknown as RequestHandler)
router.post('/:id/attachments',        authorizeManager as unknown as RequestHandler, upload.single('file') as unknown as RequestHandler, uploadAttachment       as unknown as RequestHandler)
router.delete('/:id/attachments/:attachmentId', authorizeManager as unknown as RequestHandler,                                           deleteAttachment        as unknown as RequestHandler)

// CSR-only — controller enforces ownership
router.post('/:id/sign',               signWriteUp                                                                                                              as unknown as RequestHandler)

export default router
