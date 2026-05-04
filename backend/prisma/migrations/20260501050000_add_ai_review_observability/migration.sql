-- AI Reviewer observability + confidence-driven sampling.
--
-- 1) submission_answers.ai_confidence: per-question confidence the AI
--    emitted (0.00..1.00). Lets us sort/filter answers by uncertainty.
-- 2) submissions.ai_overall_confidence: top-level confidence the AI
--    emitted for the whole review. Drives the new low-confidence
--    auto-sampling rule and the "Confidence" column on the completed
--    forms list.
-- 3) submissions.ai_extras: bag for the AI's structured side outputs
--    that don't have their own column — currently {timeline, observations}.
--    Timeline is the chronological reconstruction of agent actions tied
--    to KB steps; observations are non-scored advisories (best practice,
--    cadence, documentation quality, PII, etc.).
-- 4) forms.ai_sample_low_confidence_threshold: per-form threshold;
--    Trusted-mode AI submissions whose overall_confidence falls below
--    this value auto-route to the QA review inbox. NULL = disabled.
--
-- All four columns are nullable + additive. No data migration. Old
-- submissions render with empty-state placeholders in the UI.

ALTER TABLE `submission_answers`
  ADD COLUMN `ai_confidence` DECIMAL(3, 2) NULL AFTER `notes`;

ALTER TABLE `submissions`
  ADD COLUMN `ai_overall_confidence` DECIMAL(3, 2) NULL AFTER `score_capped`,
  ADD COLUMN `ai_extras`             JSON          NULL AFTER `ai_overall_confidence`;

ALTER TABLE `forms`
  ADD COLUMN `ai_sample_low_confidence_threshold` DECIMAL(3, 2) NULL AFTER `ai_sample_low_score_always`;
