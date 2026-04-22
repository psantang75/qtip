-- One-time backfill of the critical-fail bookkeeping columns added in
-- 20260421160000_add_critical_fail_support. Three steps:
--
--   1. critical_fail_count: count of critical-flagged questions answered NO
--      (or any falsy synonym) on each finalized submission.
--   2. score_capped: TRUE when (critical_fail_count > 0) AND the existing
--      total_score is above the form's critical_cap_percent.
--   3. total_score: clamped down to critical_cap_percent for those same rows
--      so historical audits match the new go-forward scoring rule. Audits
--      whose total_score was already <= cap are left untouched.
--
-- All filtered to status = 'FINALIZED' so DRAFT / SUBMITTED / DISPUTED rows
-- are not silently rewritten. As of this migration there are zero rows in
-- form_questions with is_critical = 1, so this script is a no-op on the
-- current dataset; it exists so the columns have a single, deterministic
-- definition the day a critical question is introduced.

UPDATE submissions s
SET s.critical_fail_count = (
  SELECT COUNT(*)
  FROM submission_answers a
  JOIN form_questions     q ON q.id = a.question_id
  WHERE a.submission_id = s.id
    AND q.is_critical = 1
    AND LOWER(TRIM(COALESCE(a.answer, ''))) IN ('no', 'false', '0', 'off')
)
WHERE s.status = 'FINALIZED';

UPDATE submissions s
JOIN forms f ON f.id = s.form_id
SET s.score_capped = 1
WHERE s.status = 'FINALIZED'
  AND s.critical_fail_count > 0
  AND s.total_score IS NOT NULL
  AND s.total_score > f.critical_cap_percent;

UPDATE submissions s
JOIN forms f ON f.id = s.form_id
SET s.total_score = f.critical_cap_percent
WHERE s.status = 'FINALIZED'
  AND s.score_capped = 1
  AND s.total_score > f.critical_cap_percent;
