-- ─────────────────────────────────────────────────────────────────────────────
-- Collections Channel Effectiveness: the billing funnel + call-level attribution.
--
-- The Channel Effectiveness report answers "of everything we billed, how much
-- processed on its own, how much fell into a dunning campaign, and of THAT how
-- much came back before vs after an agent touched it — and who took the money on
-- which kind of call". Two additions are needed for that:
--
-- 1. `pm_type` on the invoice staging + fact. The invoice extract is being widened
--    from "billing groups that already have an AR task" to the WHOLE recurring run,
--    so the report can show total billings. Splitting that run per campaign needs
--    the billing group's payment method (tblBillingGroups.PMType: 1 Credit Card /
--    2 Check / 3 ACH) alongside the cycle day, which is what separates Declined CC
--    1st from 16th from Check from ACH. Nullable + additive; every existing query
--    filters on `task_id IS NOT NULL` and is unaffected.
--
-- 2. `collections_call` — a call-level fact. `ie_fact_call_activity` is a daily
--    (agent x direction) aggregate, which cannot say whether a given payment came
--    off an inbound or an outbound call. Genesys keeps one row per conversation
--    with Direction, ANI (caller) and Dnis (dialed), and the phone DB sits on the
--    same MySQL instance as the CRM, so the extract can resolve the far-end number
--    to a CRM customer in one pass. Measured on July 2026 Billing/CS traffic:
--    77% of outbound and 71% of inbound calls resolve to a customer, ~10% hit a
--    number shared by more than one customer (recorded as AMBIGUOUS, never guessed).
--
-- Idempotent (IF NOT EXISTS / ON DUPLICATE KEY) and additive — no existing column
-- or row is dropped. Mirrors 20260907170000_create_collections_facts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Payment method on the invoice grain ─────────────────────────────────────
-- MySQL has no ADD COLUMN IF NOT EXISTS, and a bare ALTER aborts the whole script
-- on re-run, so each add is guarded through information_schema. That keeps the file
-- genuinely re-appliable — which matters here because the registry row below is
-- also the tuning knob for the call report and gets re-run when it is retuned.
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'pm_type') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `pm_type` TINYINT NULL AFTER `order_type_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'pm_type') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `pm_type` TINYINT NULL AFTER `order_type_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 2. Fact: collections_call (source pool = phone, cross-joined to CRM) ───────
CREATE TABLE IF NOT EXISTS `ie_stg_collections_call` (
  `conversation_id`   VARCHAR(64)   NULL,
  `phone_user_id`     VARCHAR(64)   NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `agent_name`        VARCHAR(120)  NULL,
  `call_date`         DATE          NULL,
  `started_on`        DATETIME      NULL,           -- ET wall time, as Genesys stores it
  `direction`         VARCHAR(10)   NULL,           -- Inbound / Outbound / Internal
  `talk_secs`         INT           NULL,
  `hold_secs`         INT           NULL,
  `customer_phone`    CHAR(10)      NULL,           -- far end, normalised to 10 digits
  `customer_id`       INT           NULL,           -- NULL unless exactly one match
  `match_kind`        VARCHAR(10)   NULL,           -- UNIQUE / AMBIGUOUS / NONE
  KEY `idx_stg_cc_conv` (`conversation_id`),
  KEY `idx_stg_cc_cust` (`customer_id`),
  KEY `idx_stg_cc_date` (`call_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`call_date`) * 100 + MONTH(`call_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_call` (
  `collections_call_key` BIGINT     NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- call date YYYYMMDD (ET)
  `conversation_id`   VARCHAR(64)   NOT NULL,
  `phone_user_id`     VARCHAR(64)   NOT NULL,
  `employee_key`      BIGINT        NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `agent_name`        VARCHAR(120)  NULL,
  `started_on`        DATETIME      NULL,
  `direction`         VARCHAR(10)   NOT NULL DEFAULT 'Outbound',
  `talk_secs`         INT           NOT NULL DEFAULT 0,
  `hold_secs`         INT           NOT NULL DEFAULT 0,
  `customer_phone`    CHAR(10)      NULL,
  `customer_id`       INT           NULL,
  `match_kind`        VARCHAR(10)   NOT NULL DEFAULT 'NONE',
  `billing_group_id`  INT           NULL,
  `task_id`           INT           NULL,           -- open AR task the call lands on
  `campaign_key`      VARCHAR(20)   NULL,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_call_key`, `date_key`),
  UNIQUE KEY `uq_fcc_conv` (`date_key`, `conversation_id`, `phone_user_id`),
  KEY `idx_fcc_task` (`task_id`),
  KEY `idx_fcc_campaign` (`campaign_key`),
  KEY `idx_fcc_emp` (`employee_key`),
  KEY `idx_fcc_cust` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── Registry row. A completed conversation never changes, so unlike touch and
-- recovery this fact does not need a long re-look window: 7 days catches anything
-- that landed late without re-walking a month and a half of calls every run. The
-- customer->task resolution is the expensive step (one lookup per call against the
-- task fact), which is also why this runs every 4 hours rather than hourly — the
-- report reads a campaign lifecycle, not a live queue. ────────────────────────
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('collections_call', 'Collections Call', 'phone',
   'collections_call.extract.sql', 'collections_call.transform.sql',
   'ie_stg_collections_call', 'ie_fact_collections_call',
   'INCREMENTAL_WINDOW', 15, 7, 240, NULL, 1)
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
  ('collections_call', 'Collections Call', 'source_report', 'source-collections_call', 'run_recency',
   'ie_fact_collections_call', NULL, NULL, 7, 60, 0, 0, 56, 50.00, 15.00, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`   = VALUES(`display_name`),
  `producer_kind`  = VALUES(`producer_kind`),
  `producer_ref`   = VALUES(`producer_ref`),
  `check_kind`     = VALUES(`check_kind`),
  `fact_table`     = VALUES(`fact_table`),
  `date_column`    = VALUES(`date_column`),
  `date_kind`      = VALUES(`date_kind`);
