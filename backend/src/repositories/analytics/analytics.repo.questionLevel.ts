/**
 * Question-level analytics repository module.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository.getQuestionLevelAnalytics`
 * during pre-production cleanup item #29. Aggregates per-question
 * performance metrics across all submissions matching the filters.
 *
 * The original implementation duplicated 80+ lines of WHERE-fragment
 * builders inline; we now reuse the shared helpers from
 * `analytics.repo.where.ts` and the scoring helpers from
 * `analytics.repo.scoring.ts`. Verbose `console.log` debug output
 * was removed during the same cleanup pass — production deploys
 * should rely on `winston` for diagnostics, not stdout.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import {
  calculateQuestionScore,
  getMaxPossibleScore,
  loadRadioOptionsByQuestion,
} from './analytics.repo.scoring'

function buildQuestionDefinitionWhere(filters: any): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`fc.weight > 0`,
    Prisma.sql`fq.question_type != 'SUB_CATEGORY'`,
    Prisma.sql`fq.question_type != 'TEXT'`,
    Prisma.sql`NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)`,
    Prisma.sql`NOT (
      fq.question_type = 'RADIO'
      AND NOT EXISTS (
        SELECT 1 FROM radio_options ro
        WHERE ro.question_id = fq.id AND ro.score > 0
      )
    )`,
  ]

  if ('formIds' in filters && filters.formIds?.length > 0) {
    conditions.push(filters.formIds.length === 1
      ? Prisma.sql`fc.form_id = ${filters.formIds[0]}`
      : Prisma.sql`fc.form_id IN (${Prisma.join(filters.formIds)})`)
  } else if ('form_id' in filters && filters.form_id) {
    conditions.push(Prisma.sql`fc.form_id = ${filters.form_id}`)
  }

  if (filters.categoryIds?.length > 0) {
    conditions.push(Prisma.sql`fq.category_id IN (${Prisma.join(filters.categoryIds)})`)
  } else if (filters.category_id) {
    conditions.push(Prisma.sql`fq.category_id = ${filters.category_id}`)
  }

  if (filters.questionIds?.length > 0) {
    conditions.push(Prisma.sql`fq.id IN (${Prisma.join(filters.questionIds)})`)
  } else if (filters.question_id) {
    conditions.push(Prisma.sql`fq.id = ${filters.question_id}`)
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

function buildAnswerExtraWhere(filters: any): Prisma.Sql {
  const conditions: Prisma.Sql[] = []

  if ('csrIds' in filters && Array.isArray(filters.csrIds) && filters.csrIds.length > 0) {
    conditions.push(Prisma.sql`AND (CAST(sm.value AS UNSIGNED) IN (${Prisma.join(filters.csrIds)}) OR sm.value IS NULL)`)
  }

  if ('departmentIds' in filters && filters.departmentIds?.length > 0) {
    conditions.push(Prisma.sql`AND (csr_user.department_id IN (${Prisma.join(filters.departmentIds)}) OR csr_user.department_id IS NULL)`)
  } else if ('department_id' in filters && filters.department_id) {
    conditions.push(Prisma.sql`AND (csr_user.department_id = ${filters.department_id} OR csr_user.department_id IS NULL)`)
  }

  if ('formIds' in filters && Array.isArray(filters.formIds) && filters.formIds.length > 0) {
    conditions.push(Prisma.sql`AND s.form_id IN (${Prisma.join(filters.formIds)})`)
  } else if ('form_id' in filters && filters.form_id) {
    conditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`)
  }

  return conditions.length > 0 ? Prisma.join(conditions, ' ') : Prisma.sql``
}

function groupQuestionRowsByText(
  questionRows: any[],
  radioOptionsMap: Record<number, any[]>,
): Record<string, any> {
  const map: Record<string, any> = {}
  questionRows.forEach((row: any) => {
    const key = `${row.question_text}||${row.category_name}`
    if (!map[key]) {
      map[key] = {
        question_ids: [row.question_id],
        question_text: row.question_text,
        category_id: row.category_id,
        category_name: row.category_name,
        weight: row.weight,
        question_type: row.question_type,
        yes_value: row.yes_value,
        no_value: row.no_value,
        na_value: row.na_value,
        scale_max: row.scale_max,
        radioOptions: [],
      }
    } else if (!map[key].question_ids.includes(row.question_id)) {
      map[key].question_ids.push(row.question_id)
    }
    map[key].radioOptions.push(...(radioOptionsMap[row.question_id] || []))
  })
  return map
}

function aggregateGroupedQuestion(
  group: any,
  answerRows: any[],
  questionRows: any[],
  radioOptionsMap: Record<number, any[]>,
) {
  const questionAnswers = answerRows.filter(a => group.question_ids.includes(a.question_id))

  const scoresWithMax = questionAnswers.map((answer: any) => {
    const specificQuestion = questionRows.find((q: any) =>
      q.question_id === answer.question_id && q.form_id === answer.form_id,
    )
    const questionToUse = specificQuestion || group
    const opts = radioOptionsMap[answer.question_id] || []
    return {
      score: calculateQuestionScore(questionToUse, answer.answer, opts),
      maxScore: getMaxPossibleScore(questionToUse, opts),
    }
  }).filter(item => item.score !== null) as { score: number; maxScore: number }[]

  const totalResponses = questionAnswers.length
  if (scoresWithMax.length === 0) {
    return {
      question_text: group.question_text,
      category_name: group.category_name,
      weight: group.weight,
      question_type: group.question_type,
      total_responses: totalResponses,
      average_score: null,
      perfect_scores: 0,
      min_score: null,
      max_score: null,
      score_std_dev: null,
    }
  }

  const percentages = scoresWithMax.map(item =>
    item.maxScore > 0 ? (item.score / item.maxScore) * 100 : 0,
  )
  const average = percentages.reduce((s, p) => s + p, 0) / percentages.length
  const variance = percentages.reduce((s, p) => s + (p - average) ** 2, 0) / percentages.length

  return {
    question_ids: group.question_ids,
    question_id: group.question_ids[0],
    question_text: group.question_text,
    category_name: group.category_name,
    weight: group.weight,
    question_type: group.question_type,
    total_responses: totalResponses,
    average_score: Math.round(average * 100) / 100,
    perfect_scores: percentages.filter(p => p === 100).length,
    min_score: Math.round(Math.min(...percentages) * 100) / 100,
    max_score: Math.round(Math.max(...percentages) * 100) / 100,
    score_std_dev: Math.round(Math.sqrt(variance) * 100) / 100,
  }
}

export async function getQuestionLevelAnalyticsRepo(filters: any): Promise<any> {
  try {
    const questionWhere = buildQuestionDefinitionWhere(filters)

    const questionRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        fq.id AS question_id, fq.question_text, fq.category_id,
        fc.category_name, fc.form_id,
        fq.weight, fq.question_type, fq.yes_value, fq.no_value, fq.na_value,
        fq.scale_max, fq.sort_order
      FROM form_questions fq
        INNER JOIN form_categories fc ON fq.category_id = fc.id
      ${questionWhere}
      ORDER BY fc.category_name, fq.sort_order
    `)

    if (questionRows.length === 0) {
      return {
        questions: [],
        summary: {
          totalQuestions: 0,
          averageScore: null,
          highestPerformingQuestion: null,
          lowestPerformingQuestion: null,
          note: 'No questions found for the specified filters.',
        },
      }
    }

    const questionIds = questionRows.map(q => q.question_id) as number[]
    const radioOptionsMap = await loadRadioOptionsByQuestion(questionIds)

    const endDateWithTime = `${filters.end_date} 23:59:59`
    const answerExtraWhere = buildAnswerExtraWhere(filters)

    const answerRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT sa.question_id, sa.answer, s.submitted_at, s.form_id, s.id AS submission_id
      FROM submission_answers sa
        INNER JOIN submissions s ON sa.submission_id = s.id
        LEFT JOIN (
          SELECT sm.submission_id, sm.value
          FROM submission_metadata sm
          INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
        ) sm ON s.id = sm.submission_id
        LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
      WHERE s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED')
        AND sa.question_id IN (${Prisma.join(questionIds)})
        ${answerExtraWhere}
    `)

    const grouped = groupQuestionRowsByText(questionRows, radioOptionsMap)
    const processedQuestions = Object.values(grouped).map(group =>
      aggregateGroupedQuestion(group, answerRows, questionRows, radioOptionsMap),
    )

    const valid = processedQuestions.filter(q => q.average_score !== null)
    const overallAverage = valid.length > 0
      ? valid.reduce((sum, q) => sum + (q.average_score as number), 0) / valid.length
      : null

    return {
      questions: processedQuestions,
      summary: {
        totalQuestions: processedQuestions.length,
        averageScore: overallAverage != null ? Math.round(overallAverage * 100) / 100 : null,
        highestPerformingQuestion: valid.length > 0
          ? valid.reduce((max, q) => (q.average_score as number) > (max.average_score as number) ? q : max)
          : null,
        lowestPerformingQuestion: valid.length > 0
          ? valid.reduce((min, q) => (q.average_score as number) < (min.average_score as number) ? q : min)
          : null,
        note: 'Question-level scores calculated from individual submission answers. Questions with the same text from different forms are aggregated.',
      },
    }
  } catch (error) {
    logger.error('Error fetching question-level analytics:', error)
    throw new Error('Failed to fetch question-level analytics')
  }
}

import logger from '../../config/logger';