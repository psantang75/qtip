-- AI Reviewer Industry Parity (Phase 1).
--
-- Adds the schema surfaces used by every other phase in this delivery.
-- All changes are additive + nullable; no data is rewritten.
--
-- Phase 0/1 ships per-form knobs for the new sub-systems, the
-- absorb-tracking columns on calibration data so corrections can stop
-- costing prompt tokens once their lesson is baked into a rule pack,
-- and three new tables: ai_golden_set (held-out evaluation set),
-- ai_calibration_map (versioned isotonic-regression bins for
-- empirical confidence calibration), and ai_eval_runs (CI/manual
-- regression-eval history against the golden set).

-- ---------------------------------------------------------------------
-- 1) Per-form knobs for the new sub-systems
-- ---------------------------------------------------------------------
-- ai_calibration_auto_absorb_days: hybrid absorb mechanism. Calibration
--   rows older than this are auto-absorbed by the daily sweep so they
--   stop costing few-shot tokens. Default 180 — long enough that a
--   rule-pack edit cycle has plenty of time to bake them in manually.
-- ai_monthly_cost_budget_usd: per-form monthly USD ceiling for the
--   AI Reviewer cost guard. NULL = no budget enforcement (default).
-- ai_disagreement_route_threshold: per-question rolling-kappa floor
--   below which a submission is routed to the QA inbox even when its
--   confidence and score were fine. NULL = disagreement-driven sampling
--   off; default 0.40 once enabled.

ALTER TABLE `forms`
  ADD COLUMN `ai_calibration_auto_absorb_days` INT NULL DEFAULT 180,
  ADD COLUMN `ai_monthly_cost_budget_usd`      DECIMAL(8, 2) NULL,
  ADD COLUMN `ai_disagreement_route_threshold` DECIMAL(3, 2) NULL;

-- ---------------------------------------------------------------------
-- 2) Calibration absorb tracking
-- ---------------------------------------------------------------------
-- absorbed_at: when this correction's lesson was baked into a rule pack
--   or the per-form guidance. NULL = still active in few-shot prompt.
--   Absorbed rows STILL count for kappa/agreement stats; they just
--   stop being injected into new prompts.
-- absorbed_by: user id of the QA admin who marked it absorbed (NULL
--   when auto-absorbed by the daily sweep).
-- absorbed_reason: short free-text — usually a pack name + version,
--   e.g. "tech-ticket-process pack v3".

ALTER TABLE `ai_calibration_data`
  ADD COLUMN `absorbed_at`     DATETIME(3)  NULL,
  ADD COLUMN `absorbed_by`     INT UNSIGNED NULL,
  ADD COLUMN `absorbed_reason` VARCHAR(255) NULL,
  ADD INDEX `idx_calib_absorbed` (`form_id`, `absorbed_at`);

-- ---------------------------------------------------------------------
-- 3) Calibrated confidence on submissions
-- ---------------------------------------------------------------------
-- The model's nominal `overall_confidence` is poorly calibrated by
-- default — "0.85" doesn't mean 85% empirical agreement. Once we have
-- enough reviewed submissions (per Phase 4), an isotonic regression
-- maps nominal → calibrated. Routing thresholds switch to use the
-- calibrated value when an active map exists; otherwise the calibrated
-- column is identity (=== nominal).

ALTER TABLE `submissions`
  ADD COLUMN `ai_calibrated_confidence` DECIMAL(3, 2) NULL AFTER `ai_overall_confidence`;

-- ---------------------------------------------------------------------
-- 4) Golden set
-- ---------------------------------------------------------------------
-- Held-out evaluation set per form. Auto-seeder (Phase 3a) promotes
-- promoted-and-unchanged submissions; humans can also manually mark
-- a submission as golden via the submission detail UI.
--
-- The unique key on submission_id ensures the auto-seeder is
-- idempotent. Soft-archive via archived_at instead of hard delete so
-- historical eval runs stay reproducible.

CREATE TABLE `ai_golden_set` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `form_id`       INT UNSIGNED NOT NULL,
  `submission_id` INT UNSIGNED NOT NULL,
  `source`        ENUM('auto_seed', 'manual') NOT NULL,
  `marked_by`     INT UNSIGNED NULL,
  `marked_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notes`         VARCHAR(500) NULL,
  `archived_at`   DATETIME(3) NULL,
  UNIQUE KEY `uk_golden_submission` (`submission_id`),
  KEY `idx_golden_form` (`form_id`, `archived_at`)
);

-- ---------------------------------------------------------------------
-- 5) Calibration map (per-form, versioned)
-- ---------------------------------------------------------------------
-- Isotonic-regression bins fit by ConfidenceCalibratorFitter
-- (Phase 4b). Versioned so an admin can preview the next-version map
-- before flipping `is_active` — and so historical eval runs can
-- replay against the map that was active at the time of the run.

CREATE TABLE `ai_calibration_map` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `form_id`      INT UNSIGNED NOT NULL,
  `version`      INT UNSIGNED NOT NULL,
  `fitted_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sample_count` INT UNSIGNED NOT NULL,
  `bins_json`    JSON NOT NULL,
  `is_active`    TINYINT(1) NOT NULL DEFAULT 0,
  `notes`        VARCHAR(500) NULL,
  UNIQUE KEY `uk_calib_map_form_version` (`form_id`, `version`),
  KEY `idx_calib_map_active` (`form_id`, `is_active`)
);

-- ---------------------------------------------------------------------
-- 6) Eval run history
-- ---------------------------------------------------------------------
-- One row per execution of the golden-set eval runner (Phase 3c).
-- Stored centrally (not in a JSON file) so the latest-run card on the
-- AI Reviewer detail page can display kappa + delta vs. the previous
-- run, and so a CI gate can compare current vs. previous run kappa.
--
-- prompt_hash + pack_hashes_json pin the exact prompt this run was
-- evaluating — critical when investigating "why did kappa drop?".

CREATE TABLE `ai_eval_runs` (
  `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `form_id`            INT UNSIGNED NOT NULL,
  `ran_at`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `triggered_by`       ENUM('manual', 'rule_pack_change', 'system_prompt_change', 'scheduled', 'ci') NOT NULL,
  `triggered_by_user`  INT UNSIGNED NULL,
  `golden_set_count`   INT UNSIGNED NOT NULL,
  `prompt_hash`        CHAR(64) NOT NULL,
  `pack_hashes_json`   JSON NOT NULL,
  `results_json`       JSON NOT NULL,
  `overall_kappa`      DECIMAL(4, 3) NULL,
  `pass`               TINYINT(1) NOT NULL,
  KEY `idx_eval_form_ran` (`form_id`, `ran_at`)
);
