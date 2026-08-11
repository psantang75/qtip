-- Tickets & Tasks daily snapshot: one row per (day, area, agent) with the
-- Current / Due Today / Past Due counts as they stood at the morning capture
-- (8am ET; RollupWorker gates on ie_config.ticket_daily_capture_hour). The live
-- ie_fact_ticket_task is a rolling SNAPSHOT (DELETE+INSERT every ~2h) with no
-- historical grain, so this table is the ONLY durable history of the buckets.
--
-- Deliberately NOT named ie_fact_* / ie_stg_* and NOT partitioned:
-- PartitionManagerWorker auto-discovers those prefixes and drops fact
-- partitions older than retention_fact_years (3y). This table is backfilled to
-- 2023 from the CRM's tblTaskHistory audit trail and must never age out; at
-- ~50-100 rows/day it needs no partitioning.
--
-- IF NOT EXISTS / INSERT IGNORE keep this idempotent (apply now, re-run later
-- by `prisma migrate deploy`).
CREATE TABLE IF NOT EXISTS `ie_ticket_task_daily` (
  `snapshot_date`   DATE               NOT NULL,
  `area`            ENUM('sales','csr') NOT NULL,
  `employee_key`    INT                NOT NULL,
  `agent_name`      VARCHAR(150)       NULL,
  -- Captured as-of the snapshot so old rows keep the department the agent was
  -- in at the time (the live report joins the CURRENT dimension instead).
  `department_name` VARCHAR(150)       NULL,
  `cur`             INT                NOT NULL DEFAULT 0,
  `due_today`       INT                NOT NULL DEFAULT 0,
  `past_due`        INT                NOT NULL DEFAULT 0,
  -- 1 = row reconstructed by the one-time CRM-history backfill script,
  -- 0 = captured live by RollupWorker at the morning gate.
  `is_backfilled`   TINYINT(1)         NOT NULL DEFAULT 0,
  `captured_at`     DATETIME           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`snapshot_date`, `area`, `employee_key`),
  KEY `idx_ttd_area_date` (`area`, `snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Capture hour (ET). Same ie_config key-value store the partition retention
-- and unlock guardrails use; INSERT IGNORE so a hand-edited value is kept.
INSERT IGNORE INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('ticket_daily_capture_hour', '8', 'Tickets & Tasks daily snapshot: first ie-rollup run at/after this hour (America/New_York) captures the day''s per-agent Current/Due Today/Past Due counts.');
