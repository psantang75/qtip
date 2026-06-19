-- Phase 5 (Sales Margin): staging + fact table and the ie_source_report registry
-- row (order_margin) that drives ingestion via the SourceReportDispatcher. Source
-- is the margin grain of ReportLeadsAllBySourceWithSalesMarginForPeriod_5yr_v2,
-- reduced to one row per order/refund (the lead-attribution layer is dropped —
-- "Leads by Salesperson" reuses ie_fact_lead). IF NOT EXISTS / ON DUPLICATE KEY
-- keep this idempotent (apply now, re-run later by `prisma migrate deploy`).

-- Staging: raw extract landing zone, TRUNCATEd at the start of each run. Columns
-- MUST match the extract SELECT aliases exactly (worker inserts by name).
-- Partitioned on margin_eligible_date's YYYYMM so the PartitionManagerWorker
-- manages it without erroring (NULLs fall into p_future).
CREATE TABLE IF NOT EXISTS `ie_stg_order_margin` (
  `order_id`                 INT            NULL,
  `refund_id`                INT            NULL,
  `order_type`               VARCHAR(20)    NULL,
  `order_date`               DATETIME       NULL,
  `margin_eligible_date`     DATETIME       NULL,
  `salesperson_id`           INT            NULL,
  `salesperson_name`         VARCHAR(150)   NULL,
  `email`                    VARCHAR(255)   NULL,
  `dept_id`                  INT            NULL,
  `customer_id`              INT            NULL,
  `customer_name`            VARCHAR(255)   NULL,
  `lead_source`              VARCHAR(150)   NULL,
  `product_margin`           DECIMAL(14,2)  NULL,
  `install_margin`           DECIMAL(14,2)  NULL,
  `shipping_margin`          DECIMAL(14,2)  NULL,
  `warranty_margin`          DECIMAL(14,2)  NULL,
  `total_margin`             DECIMAL(14,2)  NULL,
  `order_sub_count`          INT            NULL,
  `order_sub_count_sub_only` INT            NULL,
  `sub_only`                 TINYINT        NULL,
  `with_labor`               TINYINT        NULL,
  `with_radio`               TINYINT        NULL,
  KEY `idx_stg_om_email` (`email`),
  KEY `idx_stg_om_order` (`order_id`, `refund_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`margin_eligible_date`) * 100 + MONTH(`margin_eligible_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Fact: grain = one row per (order_id, refund_id). date_key is the margin
-- eligibility date (conformed to ie_dim_date) so the page scopes by "Margin
-- Eligibility Date" and partitions on (date_key DIV 100) = YYYYMM, lining up with
-- PartitionManagerWorker's boundaries. Money widened to DECIMAL(14,2). Refund rows
-- carry negative margins / sub counts and net out at READ time.
CREATE TABLE IF NOT EXISTS `ie_fact_order_margin` (
  `order_margin_key`         BIGINT         NOT NULL AUTO_INCREMENT,
  `date_key`                 INT            NOT NULL,
  `employee_key`             INT            NULL,
  `salesperson_email`        VARCHAR(255)   NULL,
  `salesperson_name`         VARCHAR(150)   NULL,
  `order_id`                 INT            NOT NULL,
  `refund_id`                INT            NOT NULL DEFAULT 0,
  `order_type`               VARCHAR(20)    NULL,
  `customer_id`              INT            NULL,
  `customer_name`            VARCHAR(255)   NULL,
  `lead_source`              VARCHAR(150)   NULL,
  `product_margin`           DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `install_margin`           DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `shipping_margin`          DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `warranty_margin`          DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `total_margin`             DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `order_sub_count`          INT            NOT NULL DEFAULT 0,
  `order_sub_count_sub_only` INT            NOT NULL DEFAULT 0,
  `sub_only`                 TINYINT        NOT NULL DEFAULT 0,
  `with_labor`               TINYINT        NOT NULL DEFAULT 0,
  `with_radio`               TINYINT        NOT NULL DEFAULT 0,
  `load_batch_id`            VARCHAR(80)    NULL,
  `loaded_at`                DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_margin_key`, `date_key`),
  KEY `idx_fom_date` (`date_key`),
  KEY `idx_fom_emp`  (`employee_key`),
  KEY `idx_fom_cust` (`customer_id`),
  KEY `idx_fom_order`(`order_id`, `refund_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Registry row: crm-source FULL_RELOAD_WINDOW, 24-month rolling window, nightly
-- off-peak (this is the heaviest report — a procedure-style extract). window_months
-- feeds :pFromDate/:pToDate. Retune frequency_minutes/run_only_hours per row later
-- (no redeploy). incremental_days is unused for window-month modes.
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('order_margin', 'Sales Margin', 'crm',
   'order_margin.extract.sql', 'order_margin.transform.sql',
   'ie_stg_order_margin', 'ie_fact_order_margin',
   'FULL_RELOAD_WINDOW', 24, 0, 1440, '2-5', 1)
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
