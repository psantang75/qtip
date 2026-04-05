-- ie_ingestion_log: Tracks every ingestion worker run for observability
CREATE TABLE `ie_ingestion_log` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `worker_name`     VARCHAR(50)   NOT NULL,
  `source_system`   VARCHAR(30)   NOT NULL,
  `run_started_at`  DATETIME      NOT NULL,
  `run_finished_at` DATETIME      NULL,
  `status`          ENUM('RUNNING','SUCCESS','PARTIAL','FAILED') NOT NULL DEFAULT 'RUNNING',
  `rows_extracted`  INT           NULL,
  `rows_loaded`     INT           NULL,
  `rows_skipped`    INT           NULL,
  `rows_errored`    INT           NULL,
  `error_message`   TEXT          NULL,
  `batch_identifier` VARCHAR(100) NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ingestion_worker` (`worker_name`, `run_started_at` DESC),
  INDEX `idx_ingestion_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_ingestion_lock: Prevents overlapping worker runs
CREATE TABLE `ie_ingestion_lock` (
  `worker_name`     VARCHAR(50)   NOT NULL,
  `locked_at`       DATETIME      NOT NULL,
  `locked_by`       VARCHAR(100)  NOT NULL,
  `expires_at`      DATETIME      NOT NULL,
  PRIMARY KEY (`worker_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_config: Key-value store for engine-wide settings
CREATE TABLE `ie_config` (
  `config_key`      VARCHAR(50)   NOT NULL,
  `config_value`    TEXT          NOT NULL,
  `description`     VARCHAR(255)  NULL,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`      INT           NULL,
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default configuration values
INSERT INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('retention_staging_days', '90', 'Number of days to keep staging table data before purging'),
  ('retention_fact_years', '3', 'Number of years to keep fact table data before archiving'),
  ('aggregation_schedule', '0 2 * * *', 'Cron expression for nightly aggregation rollup worker'),
  ('partition_lookahead_months', '3', 'Number of months of partitions to create ahead of current date'),
  ('dimension_sync_schedule', '0 1 * * *', 'Cron expression for nightly dimension sync from Qtip tables'),
  ('data_freshness_warning_hours', '24', 'Hours since last successful ingestion before showing a warning');
