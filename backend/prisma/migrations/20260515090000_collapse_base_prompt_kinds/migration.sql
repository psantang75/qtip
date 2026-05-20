-- =====================================================================
-- Collapse base prompt kinds (system.v3 + synthesis.v1) into a single
-- admin-editable Base prompt (kind = 'base').
--
-- Background
-- ----------
-- The previous design exposed three "kinds" of base prompt to admins
--   single_source  — used when a case has 1 source (one LLM call)
--   trace          — used as Pass 1 of the two-pass multi-source path
--   synthesis      — used as Pass 2 of the two-pass multi-source path
-- and let admins assign a per-form override via `forms.ai_base_prompt_id`.
--
-- "Universal" with a per-form override is a contradiction. The new model:
--   base   — ONE admin-editable universal prompt; the same Base body is
--            used by both pipelines. The pass-specific scaffolding (input
--            shape, output schema, cross-source rules) lives in code as
--            addenda (`backend/src/services/aiReviewerPromptAddenda.ts`)
--            so admins never have to think about which pass runs.
--   trace  — INFRASTRUCTURE prompt, hidden from the Library page. Edited
--            by AI engineers via PR or DB only. No admin-visible UI.
--
-- This migration moves the existing single_source + synthesis rows out
-- of the way (rename + soft-archive). On the next server boot, the
-- updated `BasePromptService.seedDefaultsIfMissing` will create a fresh
-- row with `key = 'base.v1'` and `prompt_kind = 'base'` from the new
-- `backend/prompts/ai-reviewer/base.v1.md` file. Trace row is untouched.
--
-- The archived rows are kept (not deleted) so historical eval-run
-- prompt_hash references remain resolvable and so an operator can
-- recover the previous body if anything is mis-extracted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Soft-archive the old single_source row, free up the conceptual slot.
-- Renaming the key avoids any future collision if seed code ever wants
-- to reuse "system.v3", and is_default=0 + is_archived=1 makes it
-- invisible to the Library cache filter.
--
-- Updated WHERE clause is `prompt_kind = 'single_source'` (not by key)
-- so the migration is idempotent against any name the seed used.
-- ---------------------------------------------------------------------
UPDATE `ai_base_prompt`
SET `key`         = CONCAT('archived.', `key`, '.', UNIX_TIMESTAMP()),
    `is_default`  = 0,
    `is_archived` = 1,
    `name`        = CONCAT('[archived] ', `name`),
    `description` = CONCAT(
      COALESCE(`description`, ''),
      '\n\n[Archived 20260515 — superseded by the unified base prompt (kind=base). See migration 20260515090000.]'
    )
WHERE `prompt_kind` = 'single_source';

-- ---------------------------------------------------------------------
-- Soft-archive the old synthesis row. Same rationale.
-- ---------------------------------------------------------------------
UPDATE `ai_base_prompt`
SET `key`         = CONCAT('archived.', `key`, '.', UNIX_TIMESTAMP()),
    `is_default`  = 0,
    `is_archived` = 1,
    `name`        = CONCAT('[archived] ', `name`),
    `description` = CONCAT(
      COALESCE(`description`, ''),
      '\n\n[Archived 20260515 — synthesis pass is now derived from the unified base prompt + SYNTHESIS_ADDENDUM. See migration 20260515090000.]'
    )
WHERE `prompt_kind` = 'synthesis';

-- ---------------------------------------------------------------------
-- Trace row is intentionally untouched. It remains kind='trace', stays
-- the default for that kind, and continues to back Pass 1 of the
-- two-pass pipeline. The Library UI hides kind='trace' rows so admins
-- never see it.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Per-form base assignment is being retired. The column stays in place
-- for one release (dead weight, no readers) and will be dropped in a
-- follow-up migration once we are sure nothing reads from it. Nulling
-- existing values now means the cache stops returning per-form
-- overrides immediately, even if any client still references the old
-- column.
-- ---------------------------------------------------------------------
UPDATE `forms`
SET `ai_base_prompt_id` = NULL
WHERE `ai_base_prompt_id` IS NOT NULL;
