-- Critical Fail Cap System: schema additions
--
-- Adds:
--   - form_questions.is_critical            : flag for critical-fail questions
--   - forms.critical_cap_percent            : per-form score ceiling when any critical missed
--   - submissions.critical_fail_count       : count of critical questions answered NO on a submission
--   - submissions.score_capped              : flag indicating cap rule fired
--
-- Behavior implemented in scoring engine:
--   if (any visible scored is_critical question answered NO) {
--     final_score = MIN(actual_weighted_score, forms.critical_cap_percent)
--   }

ALTER TABLE form_questions
  ADD COLUMN is_critical TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE forms
  ADD COLUMN critical_cap_percent DECIMAL(5,2) NOT NULL DEFAULT 79.00;

ALTER TABLE submissions
  ADD COLUMN critical_fail_count INT NOT NULL DEFAULT 0,
  ADD COLUMN score_capped TINYINT(1) NOT NULL DEFAULT 0;
