-- Phase 1 (Email Activity): staging + fact tables and the ie_source_report
-- registry row that drives ingestion via the SourceReportDispatcher.
-- IF NOT EXISTS / ON DUPLICATE KEY keep this idempotent so it can be applied
-- manually now and re-run safely by `prisma migrate deploy` later.

-- Staging: raw extract landing zone, TRUNCATEd each run by the generic worker.
-- Columns MUST match the extract SELECT aliases exactly (worker inserts by name).
-- Partitioned on YYYYMM so PartitionManagerWorker manages it without erroring.
CREATE TABLE IF NOT EXISTS `ie_stg_email_activity` (
  `mailbox_name`    VARCHAR(150) NULL,
  `email`           VARCHAR(255) NULL,
  `email_date`      DATE         NULL,
  `email_direction` VARCHAR(30)  NULL,
  `email_parties`   VARCHAR(50)  NULL,
  `crm_contact`     CHAR(1)      NULL,
  `email_count`     INT          NULL,
  KEY `idx_stg_email` (`email`),
  KEY `idx_stg_date`  (`email_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`email_date`) * 100 + MONTH(`email_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Fact: conformed grain = (date, employee, direction, parties, crm_contact).
-- date_key is YYYYMMDD, so partition on (date_key DIV 100) = YYYYMM to line up
-- with PartitionManagerWorker's `VALUES LESS THAN (YYYYMM)` boundaries.
CREATE TABLE IF NOT EXISTS `ie_fact_email_activity` (
  `email_activity_key` BIGINT       NOT NULL AUTO_INCREMENT,
  `date_key`           INT          NOT NULL,
  `employee_key`       INT          NULL,
  `mailbox_email`      VARCHAR(255) NOT NULL,
  `mailbox_name`       VARCHAR(150) NULL,
  `email_direction`    VARCHAR(30)  NOT NULL DEFAULT '',
  `email_parties`      VARCHAR(50)  NULL,
  `crm_contact`        CHAR(1)      NOT NULL DEFAULT 'N',
  `email_count`        INT          NOT NULL DEFAULT 0,
  `load_batch_id`      VARCHAR(80)  NULL,
  `loaded_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`email_activity_key`, `date_key`),
  KEY `idx_fea_date` (`date_key`),
  KEY `idx_fea_emp`  (`employee_key`),
  KEY `idx_fea_dir`  (`email_direction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Registry row: phone-source, incremental 35-day trailing re-pull, hourly.
-- Tune frequency_minutes / incremental_days in this row later (no redeploy).
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('email_activity', 'Email Activity', 'phone',
   'email_activity.extract.sql', 'email_activity.transform.sql',
   'ie_stg_email_activity', 'ie_fact_email_activity',
   'INCREMENTAL_WINDOW', 24, 35, 60, NULL, 1)
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
