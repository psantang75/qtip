-- Adds the ai_enabled flag to the forms table.
-- Per-form opt-in for the AI Reviewer feature: when this is true, the form
-- is eligible for AI-driven audit submissions via /api/ai-reviewer/*.
-- Defaults to false so every existing form retains current behavior.

ALTER TABLE `forms`
  ADD COLUMN `ai_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `critical_cap_percent`;
