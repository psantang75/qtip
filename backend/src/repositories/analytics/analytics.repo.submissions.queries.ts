/**
 * Branch SQL queries for `getDetailedSubmissionData`.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository.getDetailedSubmissionData`
 * during pre-production cleanup item #29. The original 580+ line
 * method dispatched between five distinct SELECTs depending on the
 * filter shape (question-level / category-level / form-level /
 * form+category breakdown / default). Each SQL is preserved verbatim
 * here so the orchestrator (`analytics.repo.submissions.ts`) is free
 * to focus on filter-shape detection, post-processing and shaping.
 *
 * ALL queries inject the same `${scoreFilter}` and `${extraWhere}`
 * fragments composed by the orchestrator from
 * `analytics.repo.where.ts` helpers so the per-filter logic is
 * defined exactly once.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'

export interface BranchQueryArgs {
  startDate: string | Date
  endDateWithTime: string
  scoreFilter: Prisma.Sql
  extraWhere: Prisma.Sql
}

export function selectQuestionLevelRows(args: BranchQueryArgs): Promise<any[]> {
  const { startDate, endDateWithTime, scoreFilter, extraWhere } = args
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id AS submission_id,
      DATE(s.submitted_at) AS submission_date,
      COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
      f.form_name,
      s.total_score AS total_score,
      fc.category_name,
      fc.id AS category_id,
      fq.id AS question_id,
      fq.question_text,
      fq.question_type,
      fq.yes_value,
      fq.no_value,
      fq.na_value,
      fq.scale_max,
      sa.answer AS question_answer,
      1 AS responses,
      ROUND(
        CASE
          WHEN fq.question_type = 'yes_no' THEN
            CASE sa.answer
              WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
              WHEN 'No' THEN COALESCE(fq.no_value, 0)
              WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
              ELSE 0
            END
          WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
            (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
          WHEN fq.question_type = 'text' THEN 100
          ELSE 0
        END
      , 2) AS question_average_score
    FROM submissions s
      INNER JOIN forms f ON s.form_id = f.id
      INNER JOIN submission_answers sa ON s.id = sa.submission_id
      INNER JOIN form_questions fq ON sa.question_id = fq.id
      INNER JOIN form_categories fc ON fq.category_id = fc.id
      LEFT JOIN (
        SELECT sm.submission_id, sm.value
        FROM submission_metadata sm
        INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
      ) sm ON s.id = sm.submission_id
      LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
    WHERE s.submitted_at BETWEEN ${startDate} AND ${endDateWithTime}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
      AND fc.weight > 0
      ${scoreFilter}
      ${extraWhere}
    ORDER BY s.id ASC, fc.category_name ASC, fq.question_text ASC
  `)
}

export function selectQuestionBreakdownRows(args: BranchQueryArgs): Promise<any[]> {
  const { startDate, endDateWithTime, scoreFilter, extraWhere } = args
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id AS submission_id,
      DATE(s.submitted_at) AS submission_date,
      COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
      f.form_name,
      s.total_score AS total_score,
      fc.category_name,
      fc.id AS category_id,
      fq.question_text,
      sa.answer AS question_answer,
      CASE
        WHEN fq.question_type = 'yes_no' THEN
          CASE sa.answer
            WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
            WHEN 'No' THEN COALESCE(fq.no_value, 0)
            WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
            ELSE 0
          END
        WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
          (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
        WHEN fq.question_type = 'text' THEN 100
        WHEN fq.question_type = 'radio' THEN
          COALESCE((SELECT ro.score FROM radio_options ro WHERE ro.question_id = fq.id AND ro.option_text = sa.answer LIMIT 1), 0)
        ELSE 0
      END AS question_answer_value,
      fq.id AS question_id
    FROM submissions s
      INNER JOIN forms f ON s.form_id = f.id
      INNER JOIN submission_answers sa ON s.id = sa.submission_id
      INNER JOIN form_questions fq ON sa.question_id = fq.id
      INNER JOIN form_categories fc ON fq.category_id = fc.id
      LEFT JOIN (
        SELECT sm.submission_id, sm.value
        FROM submission_metadata sm
        INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
      ) sm ON s.id = sm.submission_id
      LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
    WHERE s.submitted_at BETWEEN ${startDate} AND ${endDateWithTime}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
      AND fc.weight > 0
      AND fq.question_type != 'SUB_CATEGORY'
      AND fq.question_type != 'TEXT'
      AND NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)
      AND NOT (
        fq.question_type = 'RADIO'
        AND NOT EXISTS (
          SELECT 1 FROM radio_options ro
          WHERE ro.question_id = fq.id AND ro.score > 0
        )
      )
      ${scoreFilter}
      ${extraWhere}
    ORDER BY s.id ASC, fc.category_name ASC
  `)
}

const CATEGORY_SCORE_SELECT = Prisma.sql`
  SELECT
    s.id AS submission_id,
    DATE(s.submitted_at) AS submission_date,
    COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
    f.form_name,
    s.total_score AS total_score,
    fc.category_name,
    fc.id AS category_id,
    COALESCE(cat_stats.responses, 0) AS responses,
    CASE
      WHEN COALESCE(possible_points.category_possible_points, 0) = 0 THEN NULL
      ELSE COALESCE(possible_points.category_raw_score, 0)
    END AS average_score,
    CASE
      WHEN COALESCE(possible_points.category_possible_points, 0) = 0 THEN NULL
      ELSE COALESCE(possible_points.category_raw_score, 0)
    END AS category_score,
    COALESCE(possible_points.category_possible_points, 0) AS category_possible_points,
    COALESCE(possible_points.category_earned_points, 0) AS category_earned_points
`

const CATEGORY_SCORE_FROM = Prisma.sql`
  FROM submissions s
    INNER JOIN forms f ON s.form_id = f.id
    INNER JOIN form_categories fc ON f.id = fc.form_id
    LEFT JOIN (
      SELECT sm.submission_id, sm.value
      FROM submission_metadata sm
      INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
    ) sm ON s.id = sm.submission_id
    LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
    LEFT JOIN (
      SELECT
        sa.submission_id,
        fq.category_id,
        COUNT(DISTINCT sa.question_id) AS responses,
        ROUND(AVG(
          CASE
            WHEN fq.question_type = 'yes_no' THEN
              CASE sa.answer
                WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
                WHEN 'No' THEN COALESCE(fq.no_value, 0)
                WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
                ELSE 0
              END
            WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
              (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
            WHEN fq.question_type = 'text' THEN 100
            ELSE 0
          END
        ), 2) AS average_score
      FROM submission_answers sa
      INNER JOIN form_questions fq ON sa.question_id = fq.id
      GROUP BY sa.submission_id, fq.category_id
    ) cat_stats ON s.id = cat_stats.submission_id AND fc.id = cat_stats.category_id
    LEFT JOIN (
      SELECT
        ss.submission_id,
        ss_cat.category_id,
        ss_cat.possible_points AS category_possible_points,
        ss_cat.earned_points AS category_earned_points,
        ss_cat.raw_score AS category_raw_score
      FROM score_snapshots ss
      CROSS JOIN JSON_TABLE(
        ss.snapshot_data,
        '$[*]' COLUMNS(
          category_id INT PATH '$.category_id',
          possible_points DECIMAL(10,2) PATH '$.possible_points',
          earned_points DECIMAL(10,2) PATH '$.earned_points',
          raw_score DECIMAL(10,2) PATH '$.raw_score'
        )
      ) AS ss_cat
    ) possible_points ON s.id = possible_points.submission_id AND fc.id = possible_points.category_id
`

export function selectCategoryLevelRows(args: BranchQueryArgs): Promise<any[]> {
  const { startDate, endDateWithTime, scoreFilter, extraWhere } = args
  return prisma.$queryRaw<any[]>(Prisma.sql`
    ${CATEGORY_SCORE_SELECT}
    ${CATEGORY_SCORE_FROM}
    WHERE s.submitted_at BETWEEN ${startDate} AND ${endDateWithTime}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
      AND fc.weight > 0
      ${scoreFilter}
      ${extraWhere}
    ORDER BY s.id ASC, fc.category_name ASC
  `)
}

export function selectFormCategoryBreakdownRows(args: BranchQueryArgs): Promise<any[]> {
  const { startDate, endDateWithTime, scoreFilter, extraWhere } = args
  return prisma.$queryRaw<any[]>(Prisma.sql`
    ${CATEGORY_SCORE_SELECT}
    ${CATEGORY_SCORE_FROM}
    WHERE s.submitted_at BETWEEN ${startDate} AND ${endDateWithTime}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
      AND fc.weight > 0
      ${scoreFilter}
      ${extraWhere}
    ORDER BY s.id ASC
  `)
}

export function selectFormLevelRows(args: BranchQueryArgs): Promise<any[]> {
  const { startDate, endDateWithTime, scoreFilter, extraWhere } = args
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id AS submission_id,
      DATE(s.submitted_at) AS submission_date,
      COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
      f.form_name,
      s.total_score AS total_score
    FROM submissions s
      INNER JOIN forms f ON s.form_id = f.id
      LEFT JOIN (
        SELECT sm.submission_id, sm.value
        FROM submission_metadata sm
        INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
      ) sm ON s.id = sm.submission_id
      LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
    WHERE s.submitted_at BETWEEN ${startDate} AND ${endDateWithTime}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
      AND s.form_id IN (
        SELECT DISTINCT fc.form_id FROM form_categories fc WHERE fc.weight > 0
      )
      ${scoreFilter}
      ${extraWhere}
    ORDER BY s.id ASC
  `)
}

export function selectDefaultRows(args: BranchQueryArgs): Promise<any[]> {
  const { startDate, endDateWithTime, scoreFilter, extraWhere } = args
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      s.id AS submission_id,
      DATE(s.submitted_at) AS submission_date,
      s.total_score AS total_score,
      s.status,
      s.submitted_at,
      f.id AS form_id,
      f.form_name,
      COALESCE(CAST(sm.value AS UNSIGNED), 0) AS csr_id,
      COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
      COALESCE(csr_user.department_id, 0) AS department_id,
      COALESCE(d.department_name, 'Unknown Department') AS department_name,
      qa.id AS qa_id,
      qa.username AS qa_name
    FROM submissions s
      INNER JOIN forms f ON s.form_id = f.id
      INNER JOIN users qa ON s.submitted_by = qa.id
      LEFT JOIN (
        SELECT sm.submission_id, sm.value
        FROM submission_metadata sm
        INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
      ) sm ON s.id = sm.submission_id
      LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
      LEFT JOIN departments d ON csr_user.department_id = d.id
    WHERE s.submitted_at BETWEEN ${startDate} AND ${endDateWithTime}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
      AND s.form_id IN (
        SELECT DISTINCT fc.form_id FROM form_categories fc WHERE fc.weight > 0
      )
      ${scoreFilter}
      ${extraWhere}
    ORDER BY s.id ASC
  `)
}
