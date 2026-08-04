-- ─────────────────────────────────────────────────────────────────────────────
-- Call Campaign publishing — a campaign calendar is not visible to agents until
-- an Admin or Manager releases it, at two levels:
--
--   1. the SCHEDULE itself (campaign_schedule.status) — a DRAFT schedule is
--      invisible in full, whatever its months say;
--   2. each MONTH (campaign_schedule_month) — months are still projected on read,
--      so this table only records releasability. No row means DRAFT, so a month
--      nobody has published simply does not exist for an agent and cannot be
--      navigated to.
--
-- Both default to DRAFT, including for schedules that already exist: publishing
-- is a deliberate act, so nothing is released implicitly by this migration.
--
-- Mirrors the shift-scheduling publish model (schedule_shift.status DRAFT/
-- PUBLISHED); conventions match 20260803180000_add_campaigns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `campaign_schedule`
  ADD COLUMN `status`       ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT' AFTER `is_active`,
  ADD COLUMN `published_at` DATETIME NULL AFTER `status`,
  ADD COLUMN `published_by` INT      NULL AFTER `published_at`;

-- published_by carries NO foreign key, matching created_by on the sibling tables
-- (users are deactivated, not deleted).
CREATE TABLE IF NOT EXISTS `campaign_schedule_month` (
  `id`           INT      NOT NULL AUTO_INCREMENT,
  `schedule_id`  INT      NOT NULL,
  `year`         INT      NOT NULL,
  `month`        INT      NOT NULL,
  `status`       ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `published_at` DATETIME NULL,
  `published_by` INT      NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_schedule_month` (`schedule_id`, `year`, `month`),
  INDEX `idx_campaign_schedule_month_status` (`schedule_id`, `status`),
  CONSTRAINT `fk_campaign_schedule_month_schedule`
    FOREIGN KEY (`schedule_id`) REFERENCES `campaign_schedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
