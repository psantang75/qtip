import { Router, RequestHandler } from 'express'
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
  createLinkedCoachingSession,
} from '../controllers/writeup.controller'

const router = Router()
router.use(authenticate as unknown as RequestHandler)

router.get('/',                        getWriteUps                    as unknown as RequestHandler)
router.post('/',                       createWriteUp                  as unknown as RequestHandler)
router.post('/coaching-session',       createLinkedCoachingSession    as unknown as RequestHandler)
router.get('/qa-search',               searchQaRecords                as unknown as RequestHandler)
router.get('/coaching-search',         searchCoachingSessions         as unknown as RequestHandler)
router.get('/prior-discipline/:csrId', getPriorDiscipline             as unknown as RequestHandler)
router.get('/:id',                     getWriteUpById          as unknown as RequestHandler)
router.put('/:id',                     updateWriteUp           as unknown as RequestHandler)
router.patch('/:id/status',            transitionStatus        as unknown as RequestHandler)
router.post('/:id/sign',               signWriteUp             as unknown as RequestHandler)
router.patch('/:id/follow-up',         setFollowUp             as unknown as RequestHandler)

export default router
