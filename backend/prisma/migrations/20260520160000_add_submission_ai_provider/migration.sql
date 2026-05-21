-- Per-provider DRAFT dedup. Compare-mode runs (Anthropic vs OpenAI on
-- the same case) previously collided on (form_id, submitted_by, case_id)
-- and clobbered each other. Tagging the DRAFT with the authoring
-- provider lets `getExistingDraft` discriminate.
--
-- NULL for human-authored submissions and for legacy AI rows created
-- before this column existed. Net new behaviour only kicks in on AI
-- Reviewer multi-source writes that pass the column through.
ALTER TABLE `submissions`
  ADD COLUMN `ai_provider` VARCHAR(16) NULL AFTER `case_id`;
