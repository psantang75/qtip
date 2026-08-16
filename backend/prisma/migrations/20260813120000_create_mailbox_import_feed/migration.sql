-- ─────────────────────────────────────────────────────────────────────────────
-- mailbox_import_feed — registry for the data files QTIP expects by email.
--
-- Sibling of `ie_source_report` (which registers SQL-pull reports): each row is
-- one feed that arrives at the QTIP mailbox as an Excel attachment and lands via
-- the mailbox poller as an `import_logs` row. Admins manage the set from
-- Insights > Report Schedules > Email Feeds (add / edit cadence + name / toggle
-- active / delete) — no redeploy.
--
--   - `data_type`     ties the feed to its import handler + `import_logs` history
--                     (must be one of importService.DATA_TYPES). Unique.
--   - `display_name`  the label shown on Report Schedules ("Paychex Punch Data").
--   - `cadence_label` free-text expected arrival note ("Daily ~6:00 AM"); display
--                     only — one mailbox poller drains every feed on one interval.
--
-- Purely additive and idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `mailbox_import_feed` (
  `id`            INT           NOT NULL AUTO_INCREMENT,
  `data_type`     VARCHAR(50)   NOT NULL,
  `display_name`  VARCHAR(100)  NOT NULL,
  `cadence_label` VARCHAR(100)  NULL,
  `is_active`     BOOLEAN       NOT NULL DEFAULT TRUE,
  `sort_order`    INT           NOT NULL DEFAULT 0,
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mailbox_feed_data_type` (`data_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the one feed known to arrive by email today. ON DUPLICATE keeps the row's
-- admin-edited values on re-run (never clobbers a live display_name/cadence).
INSERT INTO `mailbox_import_feed` (`data_type`, `display_name`, `cadence_label`, `is_active`, `sort_order`)
VALUES ('punch_data', 'Paychex Punch Data', 'Daily', 1, 0)
ON DUPLICATE KEY UPDATE `data_type` = `data_type`;
