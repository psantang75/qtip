-- Service Counts (Company Reporting): staging + fact table and the ie_source_report
-- registry row (service_counts) that drives ingestion via the SourceReportDispatcher.
-- Source is dmcms_prod.sp_ReportServiceCountsByMonthByProviderByZoneType (the Excel
-- "ServiceCountsByProvider" workbook), collapsed to one row per (month, provider
-- segment). IF NOT EXISTS / ON DUPLICATE KEY keep this idempotent (apply now, re-run
-- later by `prisma migrate deploy`). Additive only — no existing object is altered.

-- Staging: raw extract landing zone, TRUNCATEd at the start of each run. Columns MUST
-- match the extract SELECT aliases exactly (worker inserts by name). Partitioned on
-- month_date's YYYYMM so the PartitionManagerWorker manages it without erroring.
CREATE TABLE IF NOT EXISTS `ie_stg_service_counts` (
  `month_date`          DATE          NULL,
  `year_month`          VARCHAR(6)    NULL,
  `provider_bucket_id`  INT           NULL,
  `segment_key`         VARCHAR(32)   NULL,
  `started`             INT           NULL,
  `stopped`             INT           NULL,
  `active_total`        INT           NULL,
  `reactivated`         INT           NULL,
  KEY `idx_stg_fsc` (`year_month`, `segment_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`month_date`) * 100 + MONTH(`month_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Fact: grain = one row per (month, provider segment). date_key is the first of the
-- month (YYYYMM01) conformed to ie_dim_date; partitions on (date_key DIV 100) = YYYYMM
-- lining up with PartitionManagerWorker's boundaries. active_total is the point-in-time
-- active base at end of month; started/stopped/reactivated are that month's flows.
CREATE TABLE IF NOT EXISTS `ie_fact_service_counts` (
  `service_counts_key`  BIGINT        NOT NULL AUTO_INCREMENT,
  `date_key`            INT           NOT NULL,
  `year_month`          VARCHAR(6)    NOT NULL,
  `provider_bucket_id`  INT           NOT NULL,
  `segment_key`         VARCHAR(32)   NOT NULL,
  `started`             INT           NOT NULL DEFAULT 0,
  `stopped`             INT           NOT NULL DEFAULT 0,
  `active_total`        INT           NOT NULL DEFAULT 0,
  `reactivated`         INT           NOT NULL DEFAULT 0,
  `load_batch_id`       VARCHAR(80)   NULL,
  `loaded_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`service_counts_key`, `date_key`),
  UNIQUE KEY `uq_fsc_month_segment` (`date_key`, `segment_key`),
  KEY `idx_fsc_date` (`date_key`),
  KEY `idx_fsc_segment` (`segment_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Registry row: crm-source FULL_RELOAD_WINDOW with a full-history window (300 months)
-- so the transform's delete-window+insert refreshes every month each run — the extract
-- is inherently full-history (active base + 120-month reactivation lookback), so a
-- rolling partial window would double-count older months. Nightly off-peak like the
-- other heavy procedure-style CRM extract (order_margin). incremental_days unused.
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('service_counts', 'Service Counts', 'crm',
   'service_counts.extract.sql', 'service_counts.transform.sql',
   'ie_stg_service_counts', 'ie_fact_service_counts',
   'FULL_RELOAD_WINDOW', 300, 0, 1440, '2-5', 1)
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

-- Dataset freshness monitor row (Admin -> Monitoring). run_recency (freshness from
-- ie_ingestion_log's last successful run) rather than daily_fact: this report is a
-- monthly grain reloaded nightly, so there is no per-day volume to baseline. Nightly
-- cadence, expected after the 2-5 ET load window.
INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `expected_by_hour`, `cadence_minutes`,
   `arrears_days`, `business_days_only`, `baseline_lookback_days`, `warn_pct`, `red_pct`,
   `min_expected_rows`, `zero_is_red`, `is_active`)
VALUES
  ('service_counts', 'Service Counts', 'source_report', 'source-service_counts', 'run_recency',
   'ie_fact_service_counts', NULL, NULL, 7, 1440, 0, 0, 56, 50.00, 15.00, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`   = VALUES(`display_name`),
  `producer_kind`  = VALUES(`producer_kind`),
  `producer_ref`   = VALUES(`producer_ref`),
  `check_kind`     = VALUES(`check_kind`),
  `fact_table`     = VALUES(`fact_table`),
  `date_column`    = VALUES(`date_column`),
  `date_kind`      = VALUES(`date_kind`);
