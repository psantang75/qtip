-- Insights ingestion monitoring: dataset health registry + latest-status table.
--
-- ie_dataset_monitor  = one row per monitored dataset (config/thresholds). The
--                       admin UI edits the thresholds/schedule; the evaluator
--                       reads the whole active set each cycle.
-- ie_dataset_health   = latest computed status per dataset (OK/WARN/RED),
--                       upserted every eval so the dashboard reads it cheaply
--                       and alerts fire only on a status transition (status_since).
--
-- Both are small OPERATIONAL tables, deliberately NOT ie_fact_* / ie_stg_* and
-- NOT partitioned, so PartitionManagerWorker never ages them out. Baseline
-- history is read from ie_ingestion_log / the fact tables — nothing time-series
-- is stored here. IF NOT EXISTS / INSERT ... ON DUPLICATE KEY keep this
-- idempotent (apply now, re-run later by `prisma migrate deploy`).

CREATE TABLE IF NOT EXISTS `ie_dataset_monitor` (
  `id`                     INT          NOT NULL AUTO_INCREMENT,
  `dataset_code`           VARCHAR(50)  NOT NULL,
  `display_name`           VARCHAR(100) NOT NULL,
  -- 'source_report' | 'rollup_capture' | 'import_feed'
  `producer_kind`          VARCHAR(20)  NOT NULL,
  -- ie_ingestion_log.worker_name that produces this dataset (e.g. 'source-call_activity').
  `producer_ref`           VARCHAR(100) NOT NULL,
  -- 'run_recency' (freshness+volume from ie_ingestion_log) | 'daily_fact'
  -- (freshness+volume from per-day counts in the fact table).
  `check_kind`             VARCHAR(20)  NOT NULL DEFAULT 'run_recency',
  `fact_table`             VARCHAR(100) NULL,
  `date_column`            VARCHAR(64)  NULL,
  -- how to read date_column: 'date_key' (YYYYMMDD INT) | 'date' (DATE/DATETIME)
  `date_kind`              VARCHAR(10)  NULL,
  -- ET hour by which the day's data is expected to be present.
  `expected_by_hour`       TINYINT      NOT NULL DEFAULT 9,
  `cadence_minutes`        INT          NOT NULL DEFAULT 1440,
  -- 0 = same-day feed; 1 = day-behind (e.g. ticket/task productivity capture).
  `arrears_days`           TINYINT      NOT NULL DEFAULT 0,
  `business_days_only`     TINYINT(1)   NOT NULL DEFAULT 1,
  -- weekday-aware baseline window (days back) the anomaly median is drawn from.
  `baseline_lookback_days` INT          NOT NULL DEFAULT 56,
  -- latest volume below warn_pct/red_pct of the weekday baseline -> WARN/RED.
  `warn_pct`               DECIMAL(5,2) NOT NULL DEFAULT 50.00,
  `red_pct`                DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  `min_expected_rows`      INT          NOT NULL DEFAULT 0,
  -- when the latest volume is 0 against a non-zero baseline: RED if 1, else WARN.
  `zero_is_red`            TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`              TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dataset_monitor_code` (`dataset_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ie_dataset_health` (
  `dataset_code`    VARCHAR(50) NOT NULL,
  `status`          VARCHAR(10) NOT NULL DEFAULT 'OK',
  `reason`          VARCHAR(255) NULL,
  `last_success_at` DATETIME    NULL,
  `expected_by`     DATETIME    NULL,
  `last_row_count`  INT         NULL,
  `baseline_count`  INT         NULL,
  -- when the CURRENT status was first observed — drives transition-only alerts.
  `status_since`    DATETIME    NULL,
  `evaluated_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`dataset_code`),
  KEY `idx_dataset_health_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the monitor registry for the datasets that exist today. producer_ref is
-- the ie_ingestion_log worker_name (SourceReportSyncWorker uses `source-<code>`;
-- the daily rollup captures run under 'aggregation-rollup'). Re-running updates
-- the config in place without wiping any operator threshold tweaks structurally.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `expected_by_hour`, `cadence_minutes`,
   `arrears_days`, `business_days_only`, `baseline_lookback_days`, `warn_pct`, `red_pct`,
   `min_expected_rows`, `zero_is_red`, `is_active`)
VALUES
  ('email_activity', 'Email Activity', 'source_report', 'source-email_activity', 'daily_fact',
   'ie_fact_email_activity', 'date_key', 'date_key', 10, 60, 0, 1, 56, 50.00, 15.00, 0, 0, 1),
  ('call_activity', 'Call Activity', 'source_report', 'source-call_activity', 'daily_fact',
   'ie_fact_call_activity', 'date_key', 'date_key', 10, 60, 0, 1, 56, 50.00, 15.00, 0, 0, 1),
  ('lead', 'Leads', 'source_report', 'source-lead', 'daily_fact',
   'ie_fact_lead', 'date_key', 'date_key', 11, 60, 0, 1, 56, 40.00, 10.00, 0, 0, 1),
  ('order_margin', 'Sales Margin', 'source_report', 'source-order_margin', 'daily_fact',
   'ie_fact_order_margin', 'date_key', 'date_key', 12, 60, 1, 1, 56, 40.00, 10.00, 0, 0, 1),
  ('ticket_open', 'Tickets & Tasks (snapshot)', 'source_report', 'source-ticket_open', 'run_recency',
   'ie_fact_ticket_task', NULL, NULL, 9, 240, 0, 0, 56, 50.00, 15.00, 0, 0, 1),
  ('ticket_task_productivity', 'Ticket & Task Productivity', 'rollup_capture', 'aggregation-rollup', 'daily_fact',
   'ie_ticket_task_productivity_daily', 'snapshot_date', 'date', 9, 1440, 1, 1, 56, 50.00, 15.00, 0, 0, 1),
  ('ticket_task_daily', 'Ticket & Task Daily Buckets', 'rollup_capture', 'aggregation-rollup', 'daily_fact',
   'ie_ticket_task_daily', 'snapshot_date', 'date', 9, 1440, 0, 1, 56, 50.00, 15.00, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`   = VALUES(`display_name`),
  `producer_kind`  = VALUES(`producer_kind`),
  `producer_ref`   = VALUES(`producer_ref`),
  `check_kind`     = VALUES(`check_kind`),
  `fact_table`     = VALUES(`fact_table`),
  `date_column`    = VALUES(`date_column`),
  `date_kind`      = VALUES(`date_kind`);
