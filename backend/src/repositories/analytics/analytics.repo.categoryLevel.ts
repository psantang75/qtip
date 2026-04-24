/**
 * Category-level analytics repository module.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository.getCategoryLevelAnalytics`
 * during pre-production cleanup item #29. Aggregates per-category
 * performance metrics across all submissions matching the filters.
 *
 * The original 300+ line implementation duplicated WHERE-fragment
 * builders and embedded verbose `console.log` debug calls; both have
 * been replaced with shared helpers and removed respectively. The
 * function now reuses the scoring helpers from
 * `analytics.repo.scoring.ts` so question/category scoring lives in
 * exactly one place.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import {
  calculateQuestionScore,
  getMaxPossibleScore,
  loadRadioOptionsByQuestion,
} from './analytics.repo.scoring'

function buildCategoryDefinitionWhere(filters: any): Prisma.Sql {
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
    conditions.push(Prisma.sql`fc.id IN (${Prisma.join(filters.categoryIds)})`)
  } else if (filters.category_id) {
    conditions.push(Prisma.sql`fc.id = ${filters.category_id}`)
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

function groupCategoryRowsByName(categoryRows: any[]): Record<string, any> {
  const map: Record<string, any> = {}
  categoryRows.forEach((row: any) => {
    if (!map[row.category_name]) {
      map[row.category_name] = {
        category_ids: [row.category_id],
        category_name: row.category_name,
        category_weight: row.category_weight,
        form_ids: [row.form_id],
        questions: [],
      }
    } else {
      if (!map[row.category_name].category_ids.includes(row.category_id)) {
        map[row.category_name].category_ids.push(row.category_id)
      }
      if (!map[row.category_name].form_ids.includes(row.form_id)) {
        map[row.category_name].form_ids.push(row.form_id)
      }
    }

    const exists = map[row.category_name].questions.some(
      (q: any) => q.question_text === row.question_text,
    )
    if (!exists) {
      map[row.category_name].questions.push({
        question_id: row.question_id,
        question_text: row.question_text,
        question_type: row.question_type,
        question_weight: row.question_weight,
        yes_value: row.yes_value,
        no_value: row.no_value,
        na_value: row.na_value,
        scale_max: row.scale_max,
      })
    }
  })
  return map
}

function aggregateCategorySubmissions(
  category: any,
  answerRows: any[],
  categoryRows: any[],
  radioOptionsMap: Record<number, any[]>,
) {
  const categoryAnswers = answerRows.filter((a: any) =>
    category.questions.some((q: any) => {
      const original = categoryRows.find((cr: any) =>
        cr.question_id === a.question_id && category.category_ids.includes(cr.category_id),
      )
      return original && q.question_text === original.question_text
    }),
  )

  const submissionMap: Record<number, any[]> = {}
  categoryAnswers.forEach((answer: any) => {
    if (!submissionMap[answer.submission_id]) submissionMap[answer.submission_id] = []
    submissionMap[answer.submission_id].push(answer)
  })

  const submissionCategoryScores: number[] = []
  let totalResponses = 0

  Object.values(submissionMap).forEach((answers) => {
    let points = 0
    let maxPoints = 0
    answers.forEach((answer) => {
      const question = categoryRows.find((cr: any) =>
        cr.question_id === answer.question_id && category.category_ids.includes(cr.category_id),
      )
      if (!question) return
      const opts = radioOptionsMap[answer.question_id] || []
      const score = calculateQuestionScore(question, answer.answer, opts)
      if (score !== null) {
        points += score
        maxPoints += getMaxPossibleScore(question, opts)
        totalResponses++
      }
    })
    if (maxPoints > 0) {
      submissionCategoryScores.push((points / maxPoints) * 100)
    } else if (answers.length > 0) {
      submissionCategoryScores.push(0)
    }
  })

  if (submissionCategoryScores.length === 0) {
    return {
      category_ids: category.category_ids,
      category_name: category.category_name,
      category_weight: category.category_weight,
      total_questions: category.questions.length,
      total_responses: totalResponses,
      total_submissions: 0,
      average_score: null,
      min_score: null,
      max_score: null,
      median_score: null,
      category_percentage: null,
    }
  }

  const sorted = [...submissionCategoryScores].sort((a, b) => a - b)
  const average = submissionCategoryScores.reduce((s, x) => s + x, 0) / submissionCategoryScores.length
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]

  return {
    category_ids: category.category_ids,
    category_name: category.category_name,
    category_weight: category.category_weight,
    total_questions: category.questions.length,
    total_responses: totalResponses,
    total_submissions: submissionCategoryScores.length,
    average_score: Math.round(average * 100) / 100,
    min_score: Math.round(sorted[0] * 100) / 100,
    max_score: Math.round(sorted[sorted.length - 1] * 100) / 100,
    median_score: Math.round(median * 100) / 100,
    category_percentage: Math.round(average * 100) / 100,
  }
}

export async function getCategoryLevelAnalyticsRepo(filters: any): Promise<any> {
  try {
    const categoryWhere = buildCategoryDefinitionWhere(filters)

    const categoryRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        fc.id AS category_id, fc.category_name, fc.weight AS category_weight, fc.form_id,
        fq.id AS question_id, fq.question_text, fq.question_type,
        fq.weight AS question_weight, fq.yes_value, fq.no_value, fq.na_value, fq.scale_max
      FROM form_categories fc
        INNER JOIN form_questions fq ON fc.id = fq.category_id
      ${categoryWhere}
      ORDER BY fc.category_name, fq.sort_order
    `)

    if (categoryRows.length === 0) {
      return {
        categories: [],
        summary: {
          totalCategories: 0,
          averageScore: null,
          highestPerformingCategory: null,
          lowestPerformingCategory: null,
          note: 'No valid questions found for the selected categories after filtering.',
        },
      }
    }

    const questionIds = categoryRows.map(q => q.question_id) as number[]
    const radioOptionsMap = await loadRadioOptionsByQuestion(questionIds)

    const endDateWithTime = `${filters.end_date} 23:59:59`
    const answerExtraWhere = buildAnswerExtraWhere(filters)

    const answerRows = questionIds.length === 0 ? [] : await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT sa.question_id, sa.answer, s.submitted_at, s.id AS submission_id
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

    const grouped = groupCategoryRowsByName(categoryRows)
    const processedCategories = Object.values(grouped).map(category =>
      aggregateCategorySubmissions(category, answerRows, categoryRows, radioOptionsMap),
    )

    const valid = processedCategories.filter(c => c.average_score !== null)
    const overallAverage = valid.length > 0
      ? valid.reduce((sum, c) => sum + (c.average_score as number), 0) / valid.length
      : null

    return {
      categories: processedCategories,
      summary: {
        totalCategories: processedCategories.length,
        averageScore: overallAverage != null ? Math.round(overallAverage * 100) / 100 : null,
        highestPerformingCategory: valid.length > 0
          ? valid.reduce((max, c) => (c.average_score as number) > (max.average_score as number) ? c : max)
          : null,
        lowestPerformingCategory: valid.length > 0
          ? valid.reduce((min, c) => (c.average_score as number) < (min.average_score as number) ? c : min)
          : null,
        note: 'Category-level scores calculated from per-submission category scores. Categories with the same name from different forms are aggregated.',
      },
    }
  } catch (error) {
    console.error('Error fetching category-level analytics:', error)
    throw new Error('Failed to fetch category-level analytics')
  }
}
