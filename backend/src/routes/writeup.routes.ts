import { Router, RequestHandler } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate, authorizePage } from '../middleware/auth'
import { validateSchema } from '../validation/csr.validation'
import { CreateWriteUpSchema, UpdateWriteUpSchema } from '../validation/writeup.validation'
import { WriteUpListQuerySchema } from '../validation/listFilters.validation'
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

// Page-access gates (scope model, key `pw_list`):
//   view    → OWN+  (the employee the warning is about, plus editors)
//   viewAll → ALL+  (editor surfaces that expose other users' data)
//   edit    → EDIT  (create / edit / transition / attach)
const pwView    = authorizePage('pw_list', 'view')    as unknown as RequestHandler
const pwViewAll = authorizePage('pw_list', 'viewAll') as unknown as RequestHandler
const pwEdit    = authorizePage('pw_list', 'edit')    as unknown as RequestHandler

// Editor-only search/lookup routes — expose other users' data, so they
// require ALL+. Declared BEFORE `/:id` so the param route doesn't swallow them.
router.get('/qa-search',               pwViewAll, searchQaRecords                                                                                              as unknown as RequestHandler)
router.get('/coaching-search',         pwViewAll, searchCoachingSessions                                                                                       as unknown as RequestHandler)
router.get('/prior-discipline/:csrId', pwViewAll, getPriorDiscipline                                                                                           as unknown as RequestHandler)

// Self-scoped read routes — any role with OWN+ on pw_list. The service scopes
// list/detail to the viewer's own non-DRAFT records unless they can see all
// (`canSeeAll`). Attachment download is needed by the CSR the warning is about.
router.get('/',                        pwView, validateSchema(WriteUpListQuerySchema), getWriteUps                                                                as unknown as RequestHandler)
router.get('/:id',                     pwView, getWriteUpById                                                                                                   as unknown as RequestHandler)
router.get('/:id/attachments/:attachmentId',           pwView,                                                           downloadAttachment                    as unknown as RequestHandler)

// Write routes — EDIT level (Admin + Manager per the matrix). QA is excluded
// by default (performance warnings are an HR/management responsibility), but
// this is now admin-configurable via the Page Access screen rather than
// hardcoded here.
router.post('/',                       pwEdit, validateSchema(CreateWriteUpSchema), createWriteUp                                                               as unknown as RequestHandler)
router.post('/coaching-session',       pwEdit, createLinkedCoachingSession                                                                                      as unknown as RequestHandler)
router.put('/:id',                     pwEdit, validateSchema(UpdateWriteUpSchema), updateWriteUp                                                               as unknown as RequestHandler)
router.patch('/:id/internal-notes',    pwEdit, updateInternalNotes                                                                                              as unknown as RequestHandler)
router.patch('/:id/follow-up-notes',   pwEdit, updateFollowUpNotes                                                                                              as unknown as RequestHandler)
router.patch('/:id/status',            pwEdit, transitionStatus                                                                                                 as unknown as RequestHandler)
router.patch('/:id/follow-up',         pwEdit, setFollowUp                                                                                                      as unknown as RequestHandler)
router.post('/:id/attachments',        pwEdit, upload.single('file') as unknown as RequestHandler, uploadAttachment                                             as unknown as RequestHandler)
router.delete('/:id/attachments/:attachmentId', pwEdit,                                                    deleteAttachment                                     as unknown as RequestHandler)

// Sign — the CSR the warning is about acknowledges it. Requires OWN+ (the
// controller additionally enforces that it's their own record).
router.post('/:id/sign',               pwView, signWriteUp                                                                                                      as unknown as RequestHandler)

export default router
