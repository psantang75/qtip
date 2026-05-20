-- =====================================================================
-- DB-managed AI Reviewer base prompts.
--
-- Two new tables + one new column on `forms`:
--   ai_base_prompt          — parent row per logical base (system.v3,
--                             trace.v1, synthesis.v1, plus future
--                             domain-specific bases). One row per base.
--   ai_base_prompt_version  — immutable history rows. Every save creates
--                             a new version row and the parent's
--                             current_version_id pointer is updated.
--                             Rollback creates a NEW row whose body is a
--                             copy of an older version, so the timeline
--                             reads forward-only.
--   forms.ai_base_prompt_id — nullable FK; NULL means "use the default
--                             for the requested prompt_kind". Keeps every
--                             existing form byte-identical on day one.
--
-- Initial rows are seeded by BasePromptService.warmCache() at server
-- bootstrap (idempotent upsert from the .md files in
-- backend/prompts/ai-reviewer/). Once admins start editing through the UI
-- the DB diverges from the files and the DB wins; the .md files remain
-- in the repo as the disaster-recovery seed source.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ai_base_prompt
--   • `key` is the public slug. UNIQUE so service code can do
--     `WHERE key = 'system.v3'` lookups for seed checks.
--   • `prompt_kind` partitions the table by which builder consumes the
--     base (`single_source` for buildAiReviewerPrompt, `trace` for
--     buildTracePrompt, `synthesis` for buildSynthesisPrompt). Exactly
--     ONE row per `prompt_kind` should have is_default=1 — the partial
--     uniqueness is enforced in service code (MySQL doesn't support
--     conditional unique indexes on every storage engine), with a regular
--     index here to keep the lookup cheap.
--   • `is_archived` is the soft-delete flag — historical eval runs in
--     `ai_eval_runs` reference base prompts by id inside `prompt_hash`
--     so we never want to hard-delete a base that's been used.
--   • `current_version_id` is updated on every save / rollback to point
--     at the active body in the version table. NULL only during the
--     window between the parent INSERT and the first version INSERT.
-- ---------------------------------------------------------------------
CREATE TABLE `ai_base_prompt` (
  `id`                 INT          NOT NULL AUTO_INCREMENT,
  `key`                VARCHAR(64)  NOT NULL,
  `name`               VARCHAR(255) NOT NULL,
  `description`        TEXT         NULL,
  `prompt_kind`        VARCHAR(32)  NOT NULL,
  `current_version_id` INT          NULL,
  `is_default`         TINYINT(1)   NOT NULL DEFAULT 0,
  `is_archived`        TINYINT(1)   NOT NULL DEFAULT 0,
  `updated_by`         INT          NULL,
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_base_prompt_key` (`key`),
  INDEX `idx_base_prompt_kind_default` (`prompt_kind`, `is_default`, `is_archived`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ai_base_prompt_version
--   • Immutable history rows. Saves and rollbacks both INSERT a new row.
--   • UNIQUE (base_prompt_id, version) — version monotonically increases
--     per parent. Service code computes next version as MAX(version) + 1
--     inside the same transaction that inserts the row.
--   • body_md is MEDIUMTEXT (~16MB) to comfortably hold any base.
--   • ON DELETE CASCADE so archiving a base hard-cleans its history if
--     the admin chooses to delete (default flow is archive, not delete).
-- ---------------------------------------------------------------------
CREATE TABLE `ai_base_prompt_version` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `base_prompt_id` INT          NOT NULL,
  `version`        INT          NOT NULL,
  `body_md`        MEDIUMTEXT   NOT NULL,
  `change_note`    VARCHAR(500) NULL,
  `created_by`     INT          NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_base_prompt_version` (`base_prompt_id`, `version`),
  INDEX `idx_base_prompt_version_history` (`base_prompt_id`, `version` DESC),
  CONSTRAINT `fk_base_prompt_version_parent`
    FOREIGN KEY (`base_prompt_id`) REFERENCES `ai_base_prompt` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add the FK from parent to its current version (after the version table
-- exists). Nullable so the parent can be inserted before its first version.
ALTER TABLE `ai_base_prompt`
  ADD CONSTRAINT `fk_base_prompt_current_version`
    FOREIGN KEY (`current_version_id`) REFERENCES `ai_base_prompt_version` (`id`) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- forms.ai_base_prompt_id
--   • Nullable FK to the base this form should use (single_source kind).
--   • NULL means "use the default for the requested prompt_kind", which
--     is what every existing form gets — so day one is byte-identical.
--   • ON DELETE SET NULL so archiving / deleting a base doesn't break
--     forms; they fall back to the default.
-- ---------------------------------------------------------------------
ALTER TABLE `forms`
  ADD COLUMN `ai_base_prompt_id` INT NULL,
  ADD CONSTRAINT `fk_forms_ai_base_prompt`
    FOREIGN KEY (`ai_base_prompt_id`) REFERENCES `ai_base_prompt` (`id`) ON DELETE SET NULL,
  ADD INDEX `idx_forms_ai_base_prompt` (`ai_base_prompt_id`);
