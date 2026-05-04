-- Per-form opt-in: when true, AI Reviewer submissions are saved as DRAFT
-- (status='DRAFT', no scoring) and a human reviews them before promotion.
-- Phase 5 of the AI Reviewer Maturity Rollout.
ALTER TABLE `forms`
  ADD COLUMN `ai_submit_as_draft` TINYINT(1) NOT NULL DEFAULT 0 AFTER `ai_review_guidance`;
