-- =============================================================================
-- Insights Quality validation — discovery queries
--
-- Purpose: pick a "golden slice" (one agent + one form + one closed prior month)
-- with enough finalized submissions to make the per-category, per-form, and
-- KPI calculations meaningful, then dump the raw rows that feed every Quality
-- query in the codebase.
--
-- Run interactively. Output is pasted into
--   docs/insights-validation/quality.md
-- as the inputs for the hand-computed expected values.
--
-- Usage (PowerShell, dev DB):
--   $env:MYSQL_PWD = "<password>"
--   mysql -u root qtip --table -e "source backend/scripts/insights-discovery.sql"
-- =============================================================================

-- 1. Rank user × form × prior-month combos by submission count.
--    Highest count = the best slice candidate.
SELECT YEAR(s.submitted_at)  AS yr,
       MONTH(s.submitted_at) AS mo,
       csr.id                AS userId,
       csr.username          AS agent,
       f.id                  AS formId,
       f.form_name           AS formName,
       COUNT(*)              AS subs
  FROM submissions s
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
  JOIN users csr ON csr.id = CAST(sm_csr.value AS UNSIGNED)
  JOIN forms f   ON s.form_id = f.id
 WHERE s.status = 'FINALIZED'
   AND s.submitted_at < DATE_FORMAT(NOW(), '%Y-%m-01')
 GROUP BY yr, mo, csr.id, f.id
HAVING subs >= 2
 ORDER BY subs DESC, yr DESC, mo DESC
 LIMIT 15;

-- =============================================================================
-- After choosing the slice, replace the @userId / @formId / @periodStart /
-- @periodEnd values below and run the rest as a captured snapshot.
-- =============================================================================

SET @userId      = 23;
SET @formId      = 259;
SET @periodStart = '2026-02-01 00:00:00';
SET @periodEnd   = '2026-02-28 23:59:59';

-- 2. Agent context (department drives DEPARTMENT-scope filtering).
SELECT u.id, u.username, u.role_id, u.department_id, d.department_name
  FROM users u
  LEFT JOIN departments d ON u.department_id = d.id
 WHERE u.id = @userId;

-- 3. Form structure: categories and question counts. Confirms what
--    QCQualityData.queryCategoryScores will aggregate over.
SELECT f.id   AS formId,
       f.form_name,
       fc.id  AS catId,
       fc.category_name,
       fc.sort_order AS catOrder,
       COUNT(fq.id)  AS qCount
  FROM forms f
  JOIN form_categories fc ON fc.form_id = f.id
  LEFT JOIN form_questions fq ON fq.category_id = fc.id
 WHERE f.id = @formId
 GROUP BY f.id, f.form_name, fc.id, fc.category_name, fc.sort_order
 ORDER BY fc.sort_order;

-- 4. Question type breakdown for the form. Only YES_NO/SCALE/RADIO contribute
--    to category/form aggregates per EARNED_EXPR / POSSIBLE_EXPR in
--    backend/src/services/QCQualityData.ts.
SELECT fq.question_type, COUNT(*) AS cnt
  FROM form_questions fq
  JOIN form_categories fc ON fq.category_id = fc.id
 WHERE fc.form_id = @formId
 GROUP BY fq.question_type;

-- 5. Per-submission stored scores in the slice (avg of these = avg_qa_score).
SELECT s.id,
       s.submitted_at,
       s.total_score,
       ss.score AS snap_score
  FROM submissions s
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
  LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
 WHERE s.status = 'FINALIZED'
   AND s.form_id = @formId
   AND CAST(sm_csr.value AS UNSIGNED) = @userId
   AND s.submitted_at BETWEEN @periodStart AND @periodEnd
 ORDER BY s.submitted_at;

-- 6. Disputes attached to the slice. Drives dispute_rate, dispute_upheld_rate,
--    dispute_adjusted_rate, avg_dispute_resolution_time.
SELECT d.id,
       d.submission_id,
       d.status,
       d.created_at,
       d.resolved_at,
       DATEDIFF(d.resolved_at, d.created_at) AS resolutionDays
  FROM disputes d
  JOIN submissions s ON d.submission_id = s.id
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
 WHERE s.form_id = @formId
   AND CAST(sm_csr.value AS UNSIGNED) = @userId
   AND d.created_at BETWEEN @periodStart AND @periodEnd;

-- 7. Per-category earned / possible totals for the slice.
--    This is the exact aggregation QCQualityData.queryCategoryScores does,
--    restricted to a single user via the AND csr.id = @userId clause.
SELECT fc.category_name AS category,
       f.form_name      AS form,
       COUNT(DISTINCT s.id) AS audits,
       SUM(
         CASE fq.question_type
           WHEN 'YES_NO' THEN
             CASE LOWER(sa.answer)
               WHEN 'yes' THEN COALESCE(fq.yes_value, 0)
               WHEN 'no'  THEN COALESCE(fq.no_value,  0)
               WHEN 'n/a' THEN COALESCE(fq.na_value,  0)
               ELSE 0
             END
           WHEN 'SCALE' THEN COALESCE(CAST(sa.answer AS DECIMAL(5,2)), 0)
           WHEN 'RADIO' THEN COALESCE((SELECT ro.score FROM radio_options ro
                                        WHERE ro.question_id = fq.id
                                          AND ro.option_value = sa.answer LIMIT 1), 0)
           ELSE 0
         END
       ) AS earned,
       SUM(
         CASE fq.question_type
           WHEN 'YES_NO' THEN COALESCE(fq.yes_value, 0)
           WHEN 'SCALE'  THEN COALESCE(fq.scale_max, 5)
           WHEN 'RADIO'  THEN COALESCE((SELECT MAX(ro.score) FROM radio_options ro
                                          WHERE ro.question_id = fq.id), 0)
           ELSE 0
         END
       ) AS possible
  FROM submission_answers sa
  JOIN form_questions   fq ON sa.question_id   = fq.id
  JOIN form_categories  fc ON fq.category_id   = fc.id
  JOIN forms             f ON fc.form_id        = f.id
  JOIN submissions       s ON sa.submission_id  = s.id
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
  JOIN users csr ON csr.id = CAST(sm_csr.value AS UNSIGNED)
 WHERE s.status = 'FINALIZED'
   AND s.form_id = @formId
   AND csr.id = @userId
   AND s.submitted_at BETWEEN @periodStart AND @periodEnd
   AND fq.question_type IN ('YES_NO','SCALE','RADIO')
 GROUP BY fc.id, fc.category_name, f.id, f.form_name
 ORDER BY fc.sort_order;

-- 8. Per-form summary for the slice (matches QCQualityData.getFormScores
--    when scoped to the agent — currently dept-wide unless we extend it).
SELECT f.form_name AS form,
       COUNT(DISTINCT s.id) AS audits,
       AVG(COALESCE(s.total_score, ss.score)) AS avgScore
  FROM submissions s
  LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
  JOIN forms f ON s.form_id = f.id
 WHERE s.status = 'FINALIZED'
   AND s.form_id = @formId
   AND CAST(sm_csr.value AS UNSIGNED) = @userId
   AND s.submitted_at BETWEEN @periodStart AND @periodEnd
 GROUP BY f.id, f.form_name;

-- 9. Score-distribution buckets for the slice.
SELECT CASE
         WHEN COALESCE(s.total_score, ss.score) >= 90 THEN '90-100'
         WHEN COALESCE(s.total_score, ss.score) >= 80 THEN '80-89'
         WHEN COALESCE(s.total_score, ss.score) >= 70 THEN '70-79'
         WHEN COALESCE(s.total_score, ss.score) >= 60 THEN '60-69'
         ELSE 'Below 60'
       END AS bucket,
       COUNT(*) AS count
  FROM submissions s
  LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
 WHERE s.status = 'FINALIZED'
   AND s.form_id = @formId
   AND CAST(sm_csr.value AS UNSIGNED) = @userId
   AND s.submitted_at BETWEEN @periodStart AND @periodEnd
 GROUP BY bucket
 ORDER BY bucket;
