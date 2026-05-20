-- =====================================================================
-- DB-managed AI Reviewer config (replaces file-based rubrics + rule packs)
--
-- Three tables:
--   ai_form_question_rubric      — per-(form,question) grading rubric
--                                  formerly backend/prompts/form-rubrics/<form_id>.md
--   ai_rule_pack                 — reusable rule pack library
--                                  formerly backend/prompts/rule-packs/*.md
--   ai_form_rule_pack_assignment — many-to-many (form ↔ pack)
--                                  formerly backend/config/ai-form-rule-packs.json
--                                  (which was written at runtime via fs.writeFileSync —
--                                   broken on multi-instance / read-only FS deployments)
--
-- Backfill of existing file content is a separate migration that runs
-- after these tables exist (20260513100100_backfill_ai_rule_packs).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ai_form_question_rubric
--   • UNIQUE (form_id, question_id) — at most one rubric per question per form.
--   • No FK on form_id / question_id by design: lets a soft-delete of a
--     form leave orphan rubric rows recoverable via the form id (mirrors
--     how ai_calibration_map / ai_golden_set treat form_id today).
-- ---------------------------------------------------------------------
CREATE TABLE `ai_form_question_rubric` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `form_id`     INT          NOT NULL,
  `question_id` INT          NOT NULL,
  `rubric_md`   MEDIUMTEXT   NOT NULL,
  `updated_by`  INT          NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rubric_form_question` (`form_id`, `question_id`),
  INDEX `idx_rubric_form` (`form_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ai_rule_pack
--   • `key` is the public slug (matches the legacy frontmatter key).
--     UNIQUE so callers can do `WHERE key = ?` lookups.
--   • `is_archived` is the soft-delete flag — historical eval runs in
--     `ai_eval_runs` reference packs by key inside `pack_hashes_json`,
--     so we never want to hard-delete a pack that's been used.
--   • body_md is MEDIUMTEXT (~16MB) to comfortably hold any pack the
--     model could reasonably consume.
-- ---------------------------------------------------------------------
CREATE TABLE `ai_rule_pack` (
  `id`                       INT          NOT NULL AUTO_INCREMENT,
  `key`                      VARCHAR(64)  NOT NULL,
  `name`                     VARCHAR(255) NOT NULL,
  `owner_dept`               VARCHAR(64)  NOT NULL,
  `body_md`                  MEDIUMTEXT   NOT NULL,
  `always_include_urls_json` JSON         NOT NULL,
  `is_archived`              TINYINT(1)   NOT NULL DEFAULT 0,
  `updated_by`               INT          NULL,
  `created_at`               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rule_pack_key` (`key`),
  INDEX `idx_rule_pack_dept` (`owner_dept`, `is_archived`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ai_form_rule_pack_assignment
--   • Many-to-many between forms and rule packs.
--   • UNIQUE (form_id, rule_pack_id) prevents duplicate chip selections.
--   • `sort_order` preserves the picker order so packs render
--     deterministically in the prompt (lower sort_order first).
--   • FK on rule_pack_id ON DELETE CASCADE so an admin who hard-deletes
--     an unused pack also clears its assignments. No FK on form_id for
--     the same orphan-tolerance reason as the rubric table.
-- ---------------------------------------------------------------------
CREATE TABLE `ai_form_rule_pack_assignment` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `form_id`      INT          NOT NULL,
  `rule_pack_id` INT          NOT NULL,
  `sort_order`   INT          NOT NULL DEFAULT 0,
  `updated_by`   INT          NULL,
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_form_rule_pack` (`form_id`, `rule_pack_id`),
  INDEX `idx_form_rule_pack_form` (`form_id`),
  INDEX `idx_form_rule_pack_pack` (`rule_pack_id`),
  CONSTRAINT `fk_form_rule_pack_pack`
    FOREIGN KEY (`rule_pack_id`) REFERENCES `ai_rule_pack` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
