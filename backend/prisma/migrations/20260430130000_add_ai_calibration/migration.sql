-- AI Reviewer calibration lifecycle (Phase A).
--
-- 1) ai_calibration_data: durable per-form record of human-vs-AI answer
--    diffs. Feeds the rolling-agreement number on the form-builder
--    calibration tab, the per-question breakdown, and the per-form eval.
-- 2) submission_ticket_tasks index on external_id so "find all submissions
--    for ticket X" is O(log n) instead of a full table scan.
-- 3) forms.ai_sample_review_pct + ai_sample_low_score_always: per-form
--    sampling settings used in Trusted mode to route a portion of AI
--    submissions back to the QA review inbox.

CREATE TABLE `ai_calibration_data` (
  `id`                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `created_at`            DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `form_id`               INT UNSIGNED     NOT NULL,
  `ticket_id`             INT UNSIGNED     NOT NULL,
  -- 'qa_promoted_draft' | 'qa_sample_review'
  `source`                VARCHAR(32)      NOT NULL,
  `ai_submission_id`      INT UNSIGNED     NULL,
  `human_submission_id`   INT UNSIGNED     NULL,
  -- { "<question_id>": "<answer>" } — kept nullable for forward compatibility
  `ai_answers`            JSON             NULL,
  -- { "<question_id>": "<answer>" } — the human's ground truth
  `human_answers`         JSON             NOT NULL,
  `graded_by`             INT UNSIGNED     NULL,
  -- Soft-include flag: set to 0 to exclude from the rolling agreement
  -- calculation without losing audit history.
  `in_rolling_set`        TINYINT(1)       NOT NULL DEFAULT 1,
  `notes`                 TEXT             NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_calib_form_created` (`form_id`, `created_at`),
  INDEX `idx_calib_ticket` (`ticket_id`),
  INDEX `idx_calib_ai_sub` (`ai_submission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reverse-lookup index: "every submission attached to ticket X" is a
-- common query for the QA review inbox + the calibration overlay flow.
ALTER TABLE `submission_ticket_tasks`
  ADD INDEX `idx_stt_external` (`kind`, `external_id`);

-- Per-form sampling controls. Defaults: 10% random review of trusted-mode
-- AI submissions, plus always-route-low-score (anything below the form's
-- critical-fail cap goes to the inbox regardless of the random pick).
ALTER TABLE `forms`
  ADD COLUMN `ai_sample_review_pct`       INT UNSIGNED NOT NULL DEFAULT 10 AFTER `ai_submit_as_draft`,
  ADD COLUMN `ai_sample_low_score_always` TINYINT(1)   NOT NULL DEFAULT 1  AFTER `ai_sample_review_pct`;
