-- DeskTime daily activity: one row per DeskTime employee per day.
--
-- Loaded by DeskTimeSyncWorker (hourly: today + yesterday) and the
-- run-desktime-backfill CLI (whole months), both from the DeskTime REST API —
-- an API source, so it is not an ie_source_report row. Feeds the Productivity
-- report's Desk Utilization (productive_sec).
--
-- Partitioned on date_key DIV 100 (YYYYMM) like every ie_fact_* so
-- PartitionManagerWorker manages and ages it. date_key is in both the PK and the
-- upsert key (uq_fdt_emp_day), as partitioning requires. arrived/left are the
-- DeskTime account's wall clock, which is Eastern (America/Detroit).
-- IF NOT EXISTS / ON DUPLICATE KEY keep this idempotent.

CREATE TABLE IF NOT EXISTS `ie_fact_desktime_daily` (
  `desktime_daily_key`   BIGINT        NOT NULL AUTO_INCREMENT,
  `date_key`             INT           NOT NULL,
  `desktime_employee_id` INT           NOT NULL,
  `employee_key`         INT           NULL,
  `agent_email`          VARCHAR(255)  NOT NULL,
  `agent_name`           VARCHAR(150)  NULL,
  `desktime_group`       VARCHAR(100)  NULL,
  `arrived_at_et`        DATETIME      NULL,
  `left_at_et`           DATETIME      NULL,
  `is_late`              TINYINT(1)    NOT NULL DEFAULT 0,
  `online_sec`           INT           NOT NULL DEFAULT 0,
  `desktime_sec`         INT           NOT NULL DEFAULT 0,
  `at_work_sec`          INT           NOT NULL DEFAULT 0,
  `productive_sec`       INT           NOT NULL DEFAULT 0,
  `productivity_pct`     DECIMAL(6,2)  NULL,
  `efficiency_pct`       DECIMAL(6,2)  NULL,
  `load_batch_id`        VARCHAR(80)   NULL,
  `loaded_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`desktime_daily_key`, `date_key`),
  UNIQUE KEY `uq_fdt_emp_day` (`desktime_employee_id`, `date_key`),
  KEY `idx_fdt_date`  (`date_key`),
  KEY `idx_fdt_email` (`agent_email`),
  KEY `idx_fdt_emp`   (`employee_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Freshness/volume monitoring: today's rows are expected by 10:00 ET on
-- business days; the hourly sync is the producer.
INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `expected_by_hour`, `cadence_minutes`,
   `arrears_days`, `business_days_only`, `baseline_lookback_days`, `warn_pct`, `red_pct`,
   `min_expected_rows`, `zero_is_red`, `is_active`)
VALUES
  ('desktime_daily', 'DeskTime Activity', 'api_worker', 'desktime-sync', 'daily_fact',
   'ie_fact_desktime_daily', 'date_key', 'date_key', 10, 60, 0, 1, 56, 50.00, 15.00, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`  = VALUES(`display_name`),
  `producer_kind` = VALUES(`producer_kind`),
  `producer_ref`  = VALUES(`producer_ref`),
  `check_kind`    = VALUES(`check_kind`),
  `fact_table`    = VALUES(`fact_table`),
  `date_column`   = VALUES(`date_column`),
  `date_kind`     = VALUES(`date_kind`);
