-- ─────────────────────────────────────────────────────────────────────────────
-- Collections Billing Attempts: the top of the Channel Effectiveness funnel.
--
-- WHY A SEPARATE FACT AND NOT THE INVOICE FACT. A declined card usually leaves no
-- invoice behind. Billing group 9961 is typical: recurring invoices exist for
-- 2026-05-01, 06-01, 08-01 and 09-01 but NOT 07-01, even though a Declined CC task
-- was raised at 07:31:07 on 07-01 — because the charge failed at 07:31:06 with
-- "Insufficient Funds" and the run never wrote the order. Counting declines from
-- invoices therefore misses roughly half of them, which is what pinned the
-- task->invoice coverage near 39% no matter how wide the invoice extract got.
--
-- tblPaymentResponseLog is the gateway's own record and does line up with reality.
-- On the 2026-07-01 cycle, taking each billing group's FIRST response of the day:
-- 8,338 groups settled for $789,218 and 299 declined for $36,784, against 318
-- "Ops Accounts Receivable - CC" tasks created that day (the gap is ACH plus
-- same-day retries). That is the billed -> processed -> into-campaign split the
-- report opens with.
--
-- GRAIN: one billing group per attempt DAY. Cycle-run days (the 1st and the 16th)
-- carry the campaign; later days are agent- or portal-initiated charges through the
-- same gateway. Check accounts never appear here at all — they are not card-charged,
-- so the Check campaign's billings come from ie_fact_collections_invoice instead.
--
-- Idempotent (IF NOT EXISTS / ON DUPLICATE KEY) and additive.
-- Mirrors 20260907170000_create_collections_facts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `ie_stg_collections_billing` (
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `attempt_date`      DATE          NULL,
  `pm_type`           TINYINT       NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `attempted_amount`  DECIMAL(12,2) NULL,
  `attempts`          INT           NULL,
  `first_result`      VARCHAR(10)   NULL,           -- OK / DECLINED
  `decline_reason`    VARCHAR(80)   NULL,
  `settled_amount`    DECIMAL(12,2) NULL,
  `settled_on`        DATETIME      NULL,
  KEY `idx_stg_cb_bg` (`billing_group_id`),
  KEY `idx_stg_cb_date` (`attempt_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`attempt_date`) * 100 + MONTH(`attempt_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_billing` (
  `collections_billing_key` BIGINT  NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- attempt date YYYYMMDD
  `billing_group_id`  INT           NOT NULL,
  `customer_id`       INT           NULL,
  `pm_type`           TINYINT       NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `attempted_amount`  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `attempts`          INT           NOT NULL DEFAULT 0,
  `first_result`      VARCHAR(10)   NOT NULL DEFAULT 'OK',
  `decline_reason`    VARCHAR(80)   NULL,
  `settled_amount`    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `settled_on`        DATETIME      NULL,
  `task_id`           INT           NULL,           -- AR task the decline produced
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_billing_key`, `date_key`),
  UNIQUE KEY `uq_fcb_bg` (`date_key`, `billing_group_id`),
  KEY `idx_fcb_campaign` (`campaign_key`),
  KEY `idx_fcb_result` (`first_result`),
  KEY `idx_fcb_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Nightly full reload of the trailing window: a decline's task link and any later
-- settlement both land after the fact row is first written.
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('collections_billing', 'Collections Billing Attempts', 'crm',
   'collections_billing.extract.sql', 'collections_billing.transform.sql',
   'ie_stg_collections_billing', 'ie_fact_collections_billing',
   'FULL_RELOAD_WINDOW', 15, 0, 1440, '2-5', 1)
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

INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `expected_by_hour`, `cadence_minutes`,
   `arrears_days`, `business_days_only`, `baseline_lookback_days`, `warn_pct`, `red_pct`,
   `min_expected_rows`, `zero_is_red`, `is_active`)
VALUES
  ('collections_billing', 'Collections Billing Attempts', 'source_report', 'source-collections_billing',
   'run_recency', 'ie_fact_collections_billing', NULL, NULL, 7, 1440, 0, 0, 56, 50.00, 15.00, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`   = VALUES(`display_name`),
  `producer_kind`  = VALUES(`producer_kind`),
  `producer_ref`   = VALUES(`producer_ref`),
  `check_kind`     = VALUES(`check_kind`),
  `fact_table`     = VALUES(`fact_table`),
  `date_column`    = VALUES(`date_column`),
  `date_kind`      = VALUES(`date_kind`);
