import { Router, RequestHandler } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate } from '../middleware/auth'
import {
  getWriteUps,
  getWriteUpById,
  createWriteUp,
  updateWriteUp,
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
} from '../controllers/writeup.controller'

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

router.get('/',                        getWriteUps                                                      as unknown as RequestHandler)
router.post('/',                       createWriteUp                                                    as unknown as RequestHandler)
router.post('/coaching-session',       createLinkedCoachingSession                                      as unknown as RequestHandler)
router.get('/qa-search',               searchQaRecords                                                  as unknown as RequestHandler)
router.get('/coaching-search',         searchCoachingSessions                                           as unknown as RequestHandler)
router.get('/prior-discipline/:csrId', getPriorDiscipline                                               as unknown as RequestHandler)
router.get('/:id',                     getWriteUpById                                                   as unknown as RequestHandler)
router.put('/:id',                     updateWriteUp                                                    as unknown as RequestHandler)
router.patch('/:id/status',            transitionStatus                                                 as unknown as RequestHandler)
router.post('/:id/sign',               signWriteUp                                                      as unknown as RequestHandler)
router.patch('/:id/follow-up',         setFollowUp                                                      as unknown as RequestHandler)
router.post('/:id/attachments',                upload.single('file') as unknown as RequestHandler, uploadAttachment   as unknown as RequestHandler)
router.get('/:id/attachments/:attachmentId',                                                downloadAttachment  as unknown as RequestHandler)
router.delete('/:id/attachments/:attachmentId',                                             deleteAttachment    as unknown as RequestHandler)

export default router
