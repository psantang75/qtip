-- ─────────────────────────────────────────────────────────────────────────────
-- Admin unlock / reopen for QA reviews and disputes.
--
-- QTIP has no lock column anywhere — status IS the lock, and the edit APIs
-- simply do not exist past SUBMITTED. Admins occasionally need to reopen a
-- review (scoring error, wrong interaction attached) or a closed dispute
-- determination. Doing that withdraws a score the agent has already seen, so
-- every unlock is recorded as a first-class immutable event carrying the
-- reason code, the free-text justification, a snapshot of the state being
-- withdrawn (so the system can restore it), who is expected to fix it, and a
-- deadline after which the auto re-lock sweep puts it back.
--
-- Conventions match 20260803180000_add_campaigns:
--   utf8mb4 / utf8mb4_unicode_ci, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`,
--   idx_* indexes, fk_* constraints with explicit ON DELETE.
--   unlocked_by / assigned_to / closed_by carry NO foreign key (users are
--   deactivated, not deleted, and the register must survive either way).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The unlock event. One row per reopen. Never updated except to close it,
--    so the register is an append-only abuse trail.
CREATE TABLE IF NOT EXISTS `record_unlock` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `entity_type`    ENUM('SUBMISSION','DISPUTE') NOT NULL,
  `entity_id`      INT NOT NULL,
  -- Always populated (for a DISPUTE this is the dispute's parent submission)
  -- so every report joins one way regardless of entity_type.
  `submission_id`  INT NOT NULL,
  `unlocked_by`    INT NOT NULL,
  `unlocked_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reason_code`    ENUM(
                     'SCORING_ERROR',
                     'WRONG_INTERACTION',
                     'CALIBRATION_CORRECTION',
                     'POLICY_CHANGE',
                     'TECHNICAL_ISSUE',
                     'AGENT_APPEAL',
                     'OTHER'
                   ) NOT NULL,
  `reason_note`    TEXT NOT NULL,
  -- State being withdrawn. prior_snapshot holds submitted_at for a submission,
  -- and resolved_by / resolved_at / resolution_notes / dispute status for a
  -- dispute. This is exactly what the auto re-lock sweep restores.
  `prior_status`   VARCHAR(20) NOT NULL,
  `prior_score`    DECIMAL(5,2) NULL,
  `prior_snapshot` JSON NULL,
  -- Original QA for a submission, resolving manager for a dispute.
  `assigned_to`    INT NULL,
  -- Flagged, not blocked: a small team's admin is often also the QA.
  `self_service`   BOOLEAN NOT NULL DEFAULT FALSE,
  `relock_due_at`  DATETIME NOT NULL,
  -- Break-glass: unlocked past the configured window after explicit confirm.
  `beyond_window`  BOOLEAN NOT NULL DEFAULT FALSE,
  `state`          ENUM('OPEN','CLOSED','AUTO_RELOCKED') NOT NULL DEFAULT 'OPEN',
  `closed_at`      DATETIME NULL,
  `closed_by`      INT NULL,
  `new_status`     VARCHAR(20) NULL,
  `new_score`      DECIMAL(5,2) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_record_unlock_entity` (`entity_type`, `entity_id`),
  INDEX `idx_record_unlock_actor` (`unlocked_by`, `unlocked_at`),
  INDEX `idx_record_unlock_assignee` (`assigned_to`),
  INDEX `idx_record_unlock_sweep` (`state`, `relock_due_at`),
  INDEX `idx_record_unlock_submission` (`submission_id`),
  CONSTRAINT `fk_record_unlock_submission`
    FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Denormalized counters. The cap check and the "reopened" list badge both
--    need this on every row read; a COUNT subquery per row is not worth it.
ALTER TABLE `submissions`
  ADD COLUMN `reopen_count` INT NOT NULL DEFAULT 0;

ALTER TABLE `disputes`
  ADD COLUMN `reopen_count` INT NOT NULL DEFAULT 0;

-- 3. Admin-tunable guardrails, edited in Admin -> System Settings.
--    Same ie_config key-value store the KB scheduler interval uses.
INSERT IGNORE INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('unlock_window_days',    '30', 'Admin unlock: days after submit/resolve within which a record may be reopened without a break-glass confirm. Range 1..365.'),
  ('unlock_relock_days',    '3',  'Admin unlock: days a reopened record may stay open before the sweep automatically restores it. Range 1..30.'),
  ('unlock_max_per_record', '2',  'Admin unlock: hard cap on how many times a single review or dispute may be reopened. Range 1..10.');
