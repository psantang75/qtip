-- Phase 4 (Leads): staging + fact table and the ie_source_report registry row
-- (lead) that drives ingestion via the SourceReportDispatcher. Source is the live
-- lead-level select from ReportLeadsAllBySourceForPeriod_5yr (the dead margin
-- block is dropped — margin is its own Phase 5 report). IF NOT EXISTS /
-- ON DUPLICATE KEY keep this idempotent (apply now, re-run later by
-- `prisma migrate deploy`).

-- Staging: raw extract landing zone, TRUNCATEd at the start of each run. Columns
-- MUST match the extract SELECT aliases exactly (worker inserts by name).
-- Partitioned on created_on's YYYYMM so the PartitionManagerWorker manages it
-- without erroring (NULLs fall into p_future).
CREATE TABLE IF NOT EXISTS `ie_stg_lead` (
  `customer_lead_id`     INT           NULL,
  `created_on`           DATETIME      NULL,
  `lead_source_category` VARCHAR(150)  NULL,
  `lead_source`          VARCHAR(150)  NULL,
  `task_status`          VARCHAR(100)  NULL,
  `salesperson_name`     VARCHAR(150)  NULL,
  `email`                VARCHAR(255)  NULL,
  `order_id`             INT           NULL,
  `lead_total`           INT           NULL,
  `lead_converted_total` INT           NULL,
  `lead_total_paid`      INT           NULL,
  KEY `idx_stg_lead_email` (`email`),
  KEY `idx_stg_lead_lead`  (`customer_lead_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`created_on`) * 100 + MONTH(`created_on`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Fact: grain = one row per qualifying lead-task (the extract's grain). date_key
-- is the lead's created date (conformed to ie_dim_date) so the report can scope by
-- created-date period and partition on (date_key DIV 100) = YYYYMM, lining up with
-- PartitionManagerWorker's boundaries. lead_total/converted/paid are 0/1 flags
-- summed at READ time into the category/source rollups the page shows.
CREATE TABLE IF NOT EXISTS `ie_fact_lead` (
  `lead_key`             BIGINT        NOT NULL AUTO_INCREMENT,
  `date_key`             INT           NOT NULL,
  `employee_key`         INT           NULL,
  `salesperson_email`    VARCHAR(255)  NULL,
  `salesperson_name`     VARCHAR(150)  NULL,
  `customer_lead_id`     INT           NOT NULL DEFAULT 0,
  `order_id`             INT           NULL,
  `lead_source_category` VARCHAR(150)  NULL,
  `lead_source`          VARCHAR(150)  NULL,
  `task_status`          VARCHAR(100)  NULL,
  `lead_total`           INT           NOT NULL DEFAULT 0,
  `lead_converted_total` INT           NOT NULL DEFAULT 0,
  `lead_total_paid`      INT           NOT NULL DEFAULT 0,
  `load_batch_id`        VARCHAR(80)   NULL,
  `loaded_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`lead_key`, `date_key`),
  KEY `idx_flead_date`  (`date_key`),
  KEY `idx_flead_emp`   (`employee_key`),
  KEY `idx_flead_cat`   (`lead_source_category`),
  KEY `idx_flead_src`   (`lead_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Registry row: crm-source FULL_RELOAD_WINDOW, 24-month rolling window, nightly.
-- window_months feeds :pFromDate/:pToDate. Retune frequency_minutes/run_only_hours
-- per row later (no redeploy). incremental_days is unused for window-month modes.
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('lead', 'Leads', 'crm',
   'lead.extract.sql', 'lead.transform.sql',
   'ie_stg_lead', 'ie_fact_lead',
   'FULL_RELOAD_WINDOW', 24, 0, 1440, NULL, 1)
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
