-- Add per-form free-text AI Reviewer guidance. Injected into Claude's
-- system prompt as form-specific grading rules.
ALTER TABLE `forms`
  ADD COLUMN `ai_review_guidance` TEXT NULL AFTER `ai_enabled`;
