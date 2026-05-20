-- Per-form AI model provider. Lets the form author A/B Claude vs ChatGPT
-- and pin the winner without code changes. Default "anthropic" preserves
-- current behaviour for every existing form.
ALTER TABLE `forms`
  ADD COLUMN `ai_model_provider` VARCHAR(32) NOT NULL DEFAULT 'anthropic' AFTER `ai_base_prompt_id`;
