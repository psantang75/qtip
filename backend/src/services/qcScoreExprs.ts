/**
 * Insights Quality scoring SQL — must stay in lockstep with
 * `backend/src/utils/scoringUtil.ts` (and the frontend scoringEngine).
 *
 * The form total on a submission (`submissions.total_score`) already excludes
 * N/A answers and questions hidden by conditional logic. Category / missed-
 * question reports re-derive from `submission_answers`, so these fragments
 * apply the same two skips:
 *
 *   1. N/A (`na` / `n/a`) on an `is_na_allowed` question — drop from both
 *      earned and possible. Stored answers use `na` more often than `n/a`.
 *   2. Hidden by `form_question_conditions` — drop even if a leftover answer
 *      row exists (gated follow-ups still persist their last value).
 *
 * A "miss" is then `POSSIBLE > 0 AND EARNED = 0` among applicable answers only.
 *
 * Aliases required by callers: `sa` (submission_answers), `fq` (form_questions).
 */

/** True when this answer is an allowed N/A (scoring engine skips the question). */
export const IS_NA_SQL = `(fq.is_na_allowed = 1 AND LOWER(TRIM(COALESCE(sa.answer, ''))) IN ('n/a', 'na'))`

/**
 * True when the question is visible for this submission.
 * AND within a condition group, OR across groups — same as `buildVisibilityMap`.
 * Questions with no condition rows are always visible.
 */
export const QUESTION_VISIBLE_SQL = `(
  NOT EXISTS (
    SELECT 1 FROM form_question_conditions vis_c WHERE vis_c.question_id = fq.id
  )
  OR EXISTS (
    SELECT vis_c.group_id
    FROM form_question_conditions vis_c
    LEFT JOIN submission_answers vis_ta
      ON vis_ta.submission_id = sa.submission_id
     AND vis_ta.question_id = vis_c.target_question_id
    WHERE vis_c.question_id = fq.id
    GROUP BY vis_c.group_id
    HAVING SUM(
      CASE vis_c.condition_type
        WHEN 'EQUALS' THEN
          CASE
            WHEN vis_ta.id IS NULL THEN 0
            WHEN LOWER(TRIM(COALESCE(vis_ta.answer, ''))) IN ('yes', 'true', '1', 'on')
             AND LOWER(TRIM(COALESCE(vis_c.target_value, ''))) IN ('yes', 'true', '1', 'on') THEN 1
            WHEN LOWER(TRIM(COALESCE(vis_ta.answer, ''))) IN ('no', 'false', '0', 'off')
             AND LOWER(TRIM(COALESCE(vis_c.target_value, ''))) IN ('no', 'false', '0', 'off') THEN 1
            WHEN LOWER(TRIM(COALESCE(vis_ta.answer, ''))) = LOWER(TRIM(COALESCE(vis_c.target_value, ''))) THEN 1
            ELSE 0
          END
        WHEN 'NOT_EQUALS' THEN
          CASE
            WHEN vis_ta.id IS NULL THEN 0
            WHEN LOWER(TRIM(COALESCE(vis_ta.answer, ''))) <> LOWER(TRIM(COALESCE(vis_c.target_value, ''))) THEN 1
            ELSE 0
          END
        WHEN 'EXISTS' THEN
          CASE WHEN TRIM(COALESCE(vis_ta.answer, '')) <> '' THEN 1 ELSE 0 END
        WHEN 'NOT_EXISTS' THEN
          CASE WHEN vis_ta.id IS NULL OR TRIM(COALESCE(vis_ta.answer, '')) = '' THEN 1 ELSE 0 END
        ELSE 0
      END
    ) = COUNT(*)
  )
)`

/** Visible and not an allowed N/A — contributes to earned / possible / miss counts. */
export const APPLICABLE_SQL = `(NOT ${IS_NA_SQL} AND ${QUESTION_VISIBLE_SQL})`

const RAW_EARNED_SQL = `
  CASE fq.question_type
    WHEN 'YES_NO' THEN
      CASE LOWER(TRIM(COALESCE(sa.answer, '')))
        WHEN 'yes' THEN COALESCE(fq.yes_value, 0)
        WHEN 'no'  THEN COALESCE(fq.no_value,  0)
        WHEN 'n/a' THEN COALESCE(fq.na_value,  0)
        WHEN 'na'  THEN COALESCE(fq.na_value,  0)
        ELSE 0
      END
    WHEN 'SCALE' THEN COALESCE(CAST(sa.answer AS DECIMAL(5,2)), 0)
    WHEN 'RADIO' THEN COALESCE((
      SELECT ro.score FROM radio_options ro
      WHERE ro.question_id = fq.id AND ro.option_value = sa.answer LIMIT 1
    ), 0)
    ELSE 0
  END`

const RAW_POSSIBLE_SQL = `
  CASE fq.question_type
    WHEN 'YES_NO' THEN COALESCE(fq.yes_value, 0)
    WHEN 'SCALE'  THEN COALESCE(fq.scale_max, 5)
    WHEN 'RADIO'  THEN COALESCE((
      SELECT MAX(ro.score) FROM radio_options ro WHERE ro.question_id = fq.id
    ), 0)
    ELSE 0
  END`

export const EARNED_EXPR = `CASE WHEN NOT ${APPLICABLE_SQL} THEN 0 ELSE (${RAW_EARNED_SQL}) END`

export const POSSIBLE_EXPR = `CASE WHEN NOT ${APPLICABLE_SQL} THEN 0 ELSE (${RAW_POSSIBLE_SQL}) END`
