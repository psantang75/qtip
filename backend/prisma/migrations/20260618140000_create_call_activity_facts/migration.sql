-- Phase 2 (Call Activity): staging + fact tables and the ie_source_report
-- registry row that drives ingestion via the SourceReportDispatcher.
-- IF NOT EXISTS / ON DUPLICATE KEY keep this idempotent so it can be applied
-- manually now and re-run safely by `prisma migrate deploy` later.

-- Staging: raw extract landing zone, TRUNCATEd each run by the generic worker.
-- Columns MUST match the extract SELECT aliases exactly (worker inserts by name).
-- Partitioned on YYYYMM so PartitionManagerWorker manages it without erroring.
CREATE TABLE IF NOT EXISTS `ie_stg_call_activity` (
  `agent_name`     VARCHAR(150)   NULL,
  `email`          VARCHAR(255)   NULL,
  `call_date`      DATE           NULL,
  `source_dept`    VARCHAR(100)   NULL,
  `call_direction` VARCHAR(30)    NULL,
  `call_count`     INT            NULL,
  `call_mins`      DECIMAL(10,2)  NULL,
  `hold_mins`      DECIMAL(10,2)  NULL,
  `line_mins`      DECIMAL(10,2)  NULL,
  KEY `idx_stg_call_email` (`email`),
  KEY `idx_stg_call_date`  (`call_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`call_date`) * 100 + MONTH(`call_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Fact: conformed grain = (date, employee, direction).
-- date_key is YYYYMMDD, so partition on (date_key DIV 100) = YYYYMM to line up
-- with PartitionManagerWorker's `VALUES LESS THAN (YYYYMM)` boundaries.
CREATE TABLE IF NOT EXISTS `ie_fact_call_activity` (
  `call_activity_key` BIGINT        NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,
  `employee_key`      INT           NULL,
  `agent_email`       VARCHAR(255)  NOT NULL,
  `agent_name`        VARCHAR(150)  NULL,
  `call_direction`    VARCHAR(30)   NOT NULL DEFAULT '',
  `call_count`        INT           NOT NULL DEFAULT 0,
  `call_mins`         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `hold_mins`         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `line_mins`         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`call_activity_key`, `date_key`),
  KEY `idx_fca_date` (`date_key`),
  KEY `idx_fca_emp`  (`employee_key`),
  KEY `idx_fca_dir`  (`call_direction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Registry row: phone-source, incremental 14-day trailing re-pull, hourly.
-- Tune frequency_minutes / incremental_days in this row later (no redeploy).
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('call_activity', 'Call Activity', 'phone',
   'call_activity.extract.sql', 'call_activity.transform.sql',
   'ie_stg_call_activity', 'ie_fact_call_activity',
   'INCREMENTAL_WINDOW', 24, 14, 60, NULL, 1)
ON DUPLICATE KEY UPDATE
  `report_name`        = VALUES(`report_name`),
  `source_pool`        = VALUES(`source_pool`),
  `extract_sql_file`   = VALUES(`extract_sql_file`),
  `transform_sql_file` = VALUES(`transform_sql_file`),
  `staging_table`      = VALUES(`staging_table`),
  `target_fact_table`  = VALUES(`target_fact_table`),
  `load_mode`          = VALUES(`load_mode`),
  `window_months`      = VALUES(`window_months`),
  `incremental_days`   = VALUES(`incremental_days`),
  `frequency_minutes`  = VALUES(`frequency_minutes`),
  `run_only_hours`     = VALUES(`run_only_hours`),
  `is_active`          = VALUES(`is_active`);
