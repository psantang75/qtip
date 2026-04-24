/**
 * Per-question scoring helpers (pure JS).
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29. The same `calculateQuestionScore`
 * + `getMaxPossibleScore` logic was previously inlined in
 * `getDetailedSubmissionData`, `getQuestionLevelAnalytics` and
 * `getCategoryLevelAnalytics` (and indirectly via
 * `calculateCategoryScore`). One canonical implementation now lives
 * here.
 *
 * Note: scoring SQL fragments inside per-branch queries (e.g. the
 * `CASE fq.question_type WHEN 'yes_no' THEN ...` blocks) are kept in
 * their respective query files so each branch reads top-to-bottom
 * without indirection. JS-side scoring (used after the row set is
 * fetched) all funnels through this module.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'

interface QuestionLike {
  id?: number
  question_type: string
  yes_value?: number
  no_value?: number
  na_value?: number
  scale_max?: number
}

interface RadioOption {
  question_id?: number
  option_text?: string
  option_value?: string | number
  score?: number
}

/**
 * Score a single answer for a single question. Returns `null` for
 * non-scoring question types (text, info_block, sub_category).
 */
export function calculateQuestionScore(
  question: QuestionLike,
  answer: string,
  radioOptions: RadioOption[],
): number | null {
  if (!answer) return 0

  const questionType = question.question_type.toLowerCase()
  const answerLower = answer.toLowerCase()

  switch (questionType) {
    case 'yes_no':
      if (answerLower === 'yes' || answer === 'true') {
        return question.yes_value !== undefined ? Number(question.yes_value) : 0
      }
      if (answerLower === 'no' || answer === 'false') {
        return question.no_value !== undefined ? Number(question.no_value) : 0
      }
      if (answerLower === 'n/a' || answerLower === 'na') {
        return question.na_value !== undefined ? Number(question.na_value) : 0
      }
      return 0

    case 'scale': {
      const numericAnswer = parseInt(answer, 10)
      return Number.isNaN(numericAnswer) ? 0 : numericAnswer
    }

    case 'radio':
      if (radioOptions.length > 0) {
        const selected = radioOptions.find(opt =>
          opt.option_value === answer || opt.option_text === answer,
        )
        return selected?.score || 0
      }
      return 0

    case 'text':
    case 'info_block':
    case 'sub_category':
      return null

    default:
      return 0
  }
}

/**
 * Maximum achievable score for a question (used as the denominator
 * when converting raw points → percent).
 */
export function getMaxPossibleScore(
  question: QuestionLike,
  radioOptions: RadioOption[],
): number {
  const questionType = question.question_type.toLowerCase()
  switch (questionType) {
    case 'yes_no':
      return question.yes_value !== undefined ? Number(question.yes_value) : 0
    case 'scale':
      return question.scale_max || 5
    case 'radio':
      return radioOptions.length > 0
        ? Math.max(...radioOptions.map(opt => opt.score || 0))
        : 0
    default:
      return 0
  }
}

/**
 * Compute a per-submission category score (0-100) by summing each
 * answered question's points and dividing by the maximum possible.
 *
 * Returns 0 when the category has no scorable questions or when the
 * submission has no matching answers — mirrors the legacy behaviour.
 */
export async function calculateCategoryScore(
  submission_id: number,
  category_id: number,
): Promise<number> {
  try {
    const questions = await prisma.$queryRaw<QuestionLike[]>(Prisma.sql`
      SELECT fq.id, fq.question_type, fq.yes_value, fq.no_value, fq.na_value, fq.scale_max
      FROM form_questions fq
      WHERE fq.category_id = ${category_id}
    `)

    if (questions.length === 0) return 0

    const questionIds = questions.map(q => q.id!) as number[]

    const radioOptions = await prisma.$queryRaw<RadioOption[]>(Prisma.sql`
      SELECT question_id, option_value, option_text, score
      FROM radio_options
      WHERE question_id IN (${Prisma.join(questionIds)})
    `)

    const radioOptionsByQuestion: Record<number, RadioOption[]> = {}
    radioOptions.forEach(option => {
      const qid = option.question_id!
      if (!radioOptionsByQuestion[qid]) radioOptionsByQuestion[qid] = []
      radioOptionsByQuestion[qid].push(option)
    })

    const answers = await prisma.$queryRaw<{ question_id: number; answer: string }[]>(Prisma.sql`
      SELECT question_id, answer
      FROM submission_answers
      WHERE submission_id = ${submission_id}
        AND question_id IN (${Prisma.join(questionIds)})
    `)

    let totalScore = 0
    let maxPossibleScore = 0

    answers.forEach(answer => {
      const question = questions.find(q => q.id === answer.question_id)
      if (!question) return

      const opts = radioOptionsByQuestion[answer.question_id] ?? []
      const score = calculateQuestionScore(question, answer.answer, opts)
      const maxScore = getMaxPossibleScore(question, opts)
      if (score !== null) {
        totalScore += score
        maxPossibleScore += maxScore
      }
    })

    if (maxPossibleScore === 0) return 0
    return Math.round((totalScore / maxPossibleScore) * 100 * 100) / 100
  } catch (error) {
    console.error(
      `[ANALYTICS REPOSITORY] Error calculating category score for submission ${submission_id}, category ${category_id}:`,
      error,
    )
    return 0
  }
}

/**
 * Bulk lookup helper: fetch every radio option for a set of
 * question ids and bucket them by question_id.
 *
 * Returns an empty map when the input is empty so callers can
 * unconditionally `radioOptionsByQuestion[id] ?? []`.
 */
export async function loadRadioOptionsByQuestion(
  questionIds: number[],
): Promise<Record<number, RadioOption[]>> {
  const map: Record<number, RadioOption[]> = {}
  if (questionIds.length === 0) return map

  const rows = await prisma.$queryRaw<RadioOption[]>(Prisma.sql`
    SELECT question_id, option_value, option_text, score
    FROM radio_options
    WHERE question_id IN (${Prisma.join(questionIds)})
  `)

  rows.forEach(option => {
    const qid = option.question_id!
    if (!map[qid]) map[qid] = []
    map[qid].push(option)
  })

  return map
}
