/**
 * Writeup search endpoints used by the writeup form's "find prior records"
 * pickers. Transport-only — SQL lives in
 * `services/writeups/writeup.search.service.ts` (pre-production review item
 * #29).
 */

import { Response } from 'express'
import {
  AuthReq,
  searchQaRecords as searchQaRecordsService,
  searchCoachingSessions as searchCoachingSessionsService,
} from '../../services/writeups'
import { respondWithError } from './respond'

const toStringArray = (raw: unknown): string[] =>
  ([] as string[]).concat((raw ?? []) as string[]).filter(Boolean)

/** GET /api/writeups/qa-search */
export const searchQaRecords = async (req: AuthReq, res: Response) => {
  try {
    const csrIdRaw = req.query.csr_id as string | undefined
    if (!csrIdRaw) {
      return res.status(400).json({ success: false, message: 'csr_id is required' })
    }

    const data = await searchQaRecordsService({
      csrId:        parseInt(csrIdRaw),
      formId:       req.query.form_id     ? parseInt(req.query.form_id as string) : undefined,
      dateFrom:     req.query.date_from   as string | undefined,
      dateTo:       req.query.date_to     as string | undefined,
      questionText: req.query.question_text as string | undefined,
      failedOnly:   (req.query.failed_only ?? 'true') === 'true',
      questionIds:  toStringArray(req.query.question_id),
      answerValues: toStringArray(req.query.answer_value),
    })
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'searchQaRecords', error)
  }
}

/** GET /api/writeups/coaching-search */
export const searchCoachingSessions = async (req: AuthReq, res: Response) => {
  try {
    const csrIdRaw = req.query.csr_id as string | undefined
    if (!csrIdRaw) {
      return res.status(400).json({ success: false, message: 'csr_id is required' })
    }

    const data = await searchCoachingSessionsService({
      csrId:      parseInt(csrIdRaw),
      dateFrom:   req.query.date_from as string | undefined,
      dateTo:     req.query.date_to   as string | undefined,
      topicNames: toStringArray(req.query.topic_name),
    })
    res.json({ success: true, data })
  } catch (error) {
    respondWithError(res, 'searchCoachingSessions', error)
  }
}
