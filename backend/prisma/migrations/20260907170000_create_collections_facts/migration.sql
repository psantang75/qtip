-- ─────────────────────────────────────────────────────────────────────────────
-- Collections (AR) Insights — staging + fact tables, a seeded campaign lookup,
-- and the ie_source_report / ie_dataset_monitor rows that drive ingestion via the
-- generic SourceReportDispatcher. Source is dmcms_prod (CRM, read-only).
--
-- Five conformed facts (task, invoice, touch, recovery, subscription). Each has a
-- matching ie_stg_* landing table partitioned on its source date's YYYYMM, and a
-- fact partitioned on (date_key DIV 100) = YYYYMM so PartitionManagerWorker manages
-- them without erroring. Agent identity conforms to ie_dim_employee by email; dates
-- to ie_dim_date. Idempotent (IF NOT EXISTS / ON DUPLICATE KEY) + additive only —
-- no existing object is altered. Mirrors 20260826120000_create_service_counts_facts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Campaign decode (small seeded lookup; NOT a partitioned fact / SCD dim) ─────
CREATE TABLE IF NOT EXISTS `ie_dim_collections_campaign` (
  `campaign_key`  VARCHAR(20)  NOT NULL,
  `label`         VARCHAR(60)  NOT NULL,
  `instrument`    VARCHAR(10)  NOT NULL,           -- CC / ACH / CHECK / EXP_CC / SALES
  `cycle`         VARCHAR(6)   NOT NULL DEFAULT 'NA', -- 1_15 / 16_31 / NA
  `success_kind`  VARCHAR(20)  NOT NULL,           -- RECOVERY_DOLLARS / CARD_UPDATE
  `dept_id`       INT          NULL,
  `color`         VARCHAR(20)  NULL,
  `sort_order`    INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`campaign_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `ie_dim_collections_campaign`
  (`campaign_key`, `label`, `instrument`, `cycle`, `success_kind`, `dept_id`, `color`, `sort_order`)
VALUES
  ('CC_1_15',  'Declined CC (1st)',    'CC',     '1_15',  'RECOVERY_DOLLARS', 2, '#00aeef', 1),
  ('CC_16_31', 'Declined CC (16th)',   'CC',     '16_31', 'RECOVERY_DOLLARS', 2, '#0090c8', 2),
  ('ACH',      'Declined ACH',         'ACH',    'NA',    'RECOVERY_DOLLARS', 2, '#1abc9c', 3),
  ('CHECK',    'Check',                'CHECK',  'NA',    'RECOVERY_DOLLARS', 2, '#f39c12', 4),
  ('EXP_CC',   'Expiring Credit Card', 'EXP_CC', 'NA',    'CARD_UPDATE',      2, '#9b59b6', 5),
  ('SALES_AR', 'Sales AR',             'SALES',  'NA',    'RECOVERY_DOLLARS', 1, '#e67e22', 6)
ON DUPLICATE KEY UPDATE
  `label`        = VALUES(`label`),
  `instrument`   = VALUES(`instrument`),
  `cycle`        = VALUES(`cycle`),
  `success_kind` = VALUES(`success_kind`),
  `dept_id`      = VALUES(`dept_id`),
  `color`        = VALUES(`color`),
  `sort_order`   = VALUES(`sort_order`);

-- ── Fact 1: collections_task ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ie_stg_collections_task` (
  `task_id`           INT           NULL,
  `task_type_id`      INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `created_on`        DATETIME      NULL,
  `created_date`      DATE          NULL,
  `final_status_id`   INT           NULL,
  `final_status_label` VARCHAR(60)  NULL,
  `outcome`           VARCHAR(24)   NULL,
  `is_success`        TINYINT       NULL,
  `terminated_flag`   TINYINT       NULL,
  KEY `idx_stg_ct_task` (`task_id`),
  KEY `idx_stg_ct_email` (`agent_email`),
  KEY `idx_stg_ct_date` (`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`created_date`) * 100 + MONTH(`created_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_task` (
  `collections_task_key` BIGINT       NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- task CreatedOn YYYYMMDD
  `task_id`           INT           NOT NULL,
  `task_type_id`      INT           NOT NULL,
  `campaign_key`      VARCHAR(20)   NOT NULL,
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `employee_key`      INT           NULL,
  `created_on`        DATETIME      NULL,
  `final_status_id`   INT           NULL,
  `final_status_label` VARCHAR(60)  NULL,
  `outcome`           VARCHAR(24)   NOT NULL DEFAULT 'OPEN',
  `is_success`        TINYINT       NOT NULL DEFAULT 0,
  `terminated_flag`   TINYINT       NOT NULL DEFAULT 0,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_task_key`, `date_key`),
  UNIQUE KEY `uq_fct_task` (`date_key`, `task_id`),
  KEY `idx_fct_campaign` (`campaign_key`),
  KEY `idx_fct_emp` (`employee_key`),
  KEY `idx_fct_bg` (`billing_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── Fact 2: collections_invoice ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ie_stg_collections_invoice` (
  `order_id`          INT           NULL,
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `order_type_id`     INT           NULL,
  `is_reactivation`   TINYINT       NULL,
  `order_date`        DATE          NULL,
  `due_date`          DATE          NULL,
  `invoice_amount`    DECIMAL(12,2) NULL,
  `cash_collected`    DECIMAL(12,2) NULL,
  `credit_memo_amount` DECIMAL(12,2) NULL,
  `writeoff_amount`   DECIMAL(12,2) NULL,
  `refund_amount`     DECIMAL(12,2) NULL,
  `open_balance`      DECIMAL(12,2) NULL,
  `outcome`           VARCHAR(16)   NULL,
  `is_cash_paid`      TINYINT       NULL,
  `paid_on`           DATETIME      NULL,
  `last_processor_kind` VARCHAR(10) NULL,
  KEY `idx_stg_ci_order` (`order_id`),
  KEY `idx_stg_ci_bg` (`billing_group_id`),
  KEY `idx_stg_ci_date` (`order_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`order_date`) * 100 + MONTH(`order_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_invoice` (
  `collections_invoice_key` BIGINT   NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- OrderDate YYYYMMDD
  `order_id`          INT           NOT NULL,
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `order_type_id`     INT           NULL,
  `is_reactivation`   TINYINT       NOT NULL DEFAULT 0,
  `order_date`        DATE          NULL,
  `due_date`          DATE          NULL,
  `invoice_amount`    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `cash_collected`    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `credit_memo_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `writeoff_amount`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `refund_amount`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `open_balance`      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `outcome`           VARCHAR(16)   NOT NULL DEFAULT 'OPEN',
  `is_cash_paid`      TINYINT       NOT NULL DEFAULT 0,
  `paid_on`           DATETIME      NULL,
  `last_processor_kind` VARCHAR(10) NULL,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_invoice_key`, `date_key`),
  UNIQUE KEY `uq_fci_order` (`date_key`, `order_id`),
  KEY `idx_fci_task` (`task_id`),
  KEY `idx_fci_campaign` (`campaign_key`),
  KEY `idx_fci_bg` (`billing_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── Fact 3: collections_touch ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ie_stg_collections_touch` (
  `action_id`         INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `status_id_after`   INT           NULL,
  `status_label`      VARCHAR(60)   NULL,
  `touch_seq`         INT           NULL,
  `touch_label`       VARCHAR(60)   NULL,
  `phase`             VARCHAR(10)   NULL,
  `is_2nd_call`       TINYINT       NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `created_on`        DATETIME      NULL,
  `created_date`      DATE          NULL,
  KEY `idx_stg_cto_action` (`action_id`),
  KEY `idx_stg_cto_task` (`task_id`),
  KEY `idx_stg_cto_date` (`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`created_date`) * 100 + MONTH(`created_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_touch` (
  `collections_touch_key` BIGINT     NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- action CreatedOn YYYYMMDD
  `action_id`         INT           NOT NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `status_id_after`   INT           NULL,
  `status_label`      VARCHAR(60)   NULL,
  `touch_seq`         INT           NULL,
  `touch_label`       VARCHAR(60)   NULL,
  `phase`             VARCHAR(10)   NULL,
  `is_2nd_call`       TINYINT       NOT NULL DEFAULT 0,
  `agent_email`       VARCHAR(255)  NULL,
  `employee_key`      INT           NULL,
  `created_on`        DATETIME      NULL,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_touch_key`, `date_key`),
  UNIQUE KEY `uq_fcto_action` (`date_key`, `action_id`),
  KEY `idx_fcto_task` (`task_id`),
  KEY `idx_fcto_campaign` (`campaign_key`),
  KEY `idx_fcto_emp` (`employee_key`),
  KEY `idx_fcto_seq` (`touch_seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── Fact 4: collections_recovery ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ie_stg_collections_recovery` (
  `payments_credits_order_id` INT   NULL,
  `payment_credit_id` INT           NULL,
  `order_id`          INT           NULL,
  `billing_group_id`  INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `payment_type`      VARCHAR(16)   NULL,
  `processor_crm_id`  INT           NULL,
  `processor_kind`    VARCHAR(10)   NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `amount`            DECIMAL(12,2) NULL,
  `applied_on`        DATETIME      NULL,
  `applied_date`      DATE          NULL,
  `is_reversed`       TINYINT       NULL,
  KEY `idx_stg_cr_pco` (`payments_credits_order_id`),
  KEY `idx_stg_cr_order` (`order_id`),
  KEY `idx_stg_cr_date` (`applied_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`applied_date`) * 100 + MONTH(`applied_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_recovery` (
  `collections_recovery_key` BIGINT  NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- AppliedOn YYYYMMDD
  `payments_credits_order_id` INT    NOT NULL,
  `payment_credit_id` INT           NULL,
  `order_id`          INT           NULL,
  `billing_group_id`  INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `payment_type`      VARCHAR(16)   NULL,
  `processor_crm_id`  INT           NULL,
  `processor_kind`    VARCHAR(10)   NOT NULL DEFAULT 'NO_AGENT',
  `agent_email`       VARCHAR(255)  NULL,
  `employee_key`      INT           NULL,
  `amount`            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `applied_on`        DATETIME      NULL,
  `attributed_touch_seq` INT        NULL,
  `is_reversed`       TINYINT       NOT NULL DEFAULT 0,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_recovery_key`, `date_key`),
  UNIQUE KEY `uq_fcr_pco` (`date_key`, `payments_credits_order_id`),
  KEY `idx_fcr_order` (`order_id`),
  KEY `idx_fcr_task` (`task_id`),
  KEY `idx_fcr_campaign` (`campaign_key`),
  KEY `idx_fcr_emp` (`employee_key`),
  KEY `idx_fcr_kind` (`processor_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── Fact 5: collections_subscription ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ie_stg_collections_subscription` (
  `service_id`        INT           NULL,
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `order_part_id`     INT           NULL,
  `service_status`    VARCHAR(25)   NULL,
  `outcome`           VARCHAR(16)   NULL,
  `term_reason_id`    INT           NULL,
  `term_reason_text`  VARCHAR(250)  NULL,
  `is_ar_reason`      TINYINT       NULL,
  `term_recorded_on`  DATETIME      NULL,
  `term_effective_on` DATETIME      NULL,
  `terminated_by_crm_id` INT        NULL,
  `status_at_outcome` VARCHAR(60)   NULL,
  `reactivated_on`    DATETIME      NULL,
  `mrr_amount`        DECIMAL(12,2) NULL,
  `cohort_date`       DATE          NULL,
  KEY `idx_stg_cs_service` (`service_id`),
  KEY `idx_stg_cs_task` (`task_id`),
  KEY `idx_stg_cs_date` (`cohort_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`cohort_date`) * 100 + MONTH(`cohort_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

CREATE TABLE IF NOT EXISTS `ie_fact_collections_subscription` (
  `collections_subscription_key` BIGINT NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- campaign task CreatedOn YYYYMMDD (cohort)
  `service_id`        INT           NOT NULL,
  `billing_group_id`  INT           NULL,
  `customer_id`       INT           NULL,
  `task_id`           INT           NULL,
  `campaign_key`      VARCHAR(20)   NULL,
  `order_part_id`     INT           NULL,
  `service_status`    VARCHAR(25)   NULL,
  `outcome`           VARCHAR(16)   NOT NULL DEFAULT 'RETAINED',
  `term_reason_id`    INT           NULL,
  `term_reason_text`  VARCHAR(250)  NULL,
  `is_ar_reason`      TINYINT       NOT NULL DEFAULT 0,
  `term_recorded_on`  DATETIME      NULL,
  `term_effective_on` DATETIME      NULL,
  `terminated_by_crm_id` INT        NULL,
  `status_at_outcome` VARCHAR(60)   NULL,
  `reactivated_on`    DATETIME      NULL,
  `mrr_amount`        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`collections_subscription_key`, `date_key`),
  UNIQUE KEY `uq_fcs_service` (`date_key`, `service_id`, `task_id`),
  KEY `idx_fcs_task` (`task_id`),
  KEY `idx_fcs_campaign` (`campaign_key`),
  KEY `idx_fcs_outcome` (`outcome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── Registry rows (ie_source_report): CRM source. task/invoice/subscription are
-- FULL_RELOAD_WINDOW (rebuild trailing 15 months nightly off-peak so late payments
-- and status changes on open tasks are recaptured); touch/recovery are
-- INCREMENTAL_WINDOW (trailing 45 days, hourly). Retune by editing the row. ────────
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('collections_task', 'Collections Task', 'crm',
   'collections_task.extract.sql', 'collections_task.transform.sql',
   'ie_stg_collections_task', 'ie_fact_collections_task',
   'FULL_RELOAD_WINDOW', 15, 0, 1440, '2-5', 1),
  ('collections_invoice', 'Collections Invoice', 'crm',
   'collections_invoice.extract.sql', 'collections_invoice.transform.sql',
   'ie_stg_collections_invoice', 'ie_fact_collections_invoice',
   'FULL_RELOAD_WINDOW', 15, 0, 1440, '2-5', 1),
  ('collections_touch', 'Collections Touch', 'crm',
   'collections_touch.extract.sql', 'collections_touch.transform.sql',
   'ie_stg_collections_touch', 'ie_fact_collections_touch',
   'INCREMENTAL_WINDOW', 15, 45, 60, NULL, 1),
  ('collections_recovery', 'Collections Recovery', 'crm',
   'collections_recovery.extract.sql', 'collections_recovery.transform.sql',
   'ie_stg_collections_recovery', 'ie_fact_collections_recovery',
   'INCREMENTAL_WINDOW', 15, 45, 60, NULL, 1),
  -- Subscription outcome fact: table + registry are created here but is_active = 0
  -- until its extract/transform SQL are validated (service<->task linkage needs a
  -- fan-out-safe join). Activate by setting is_active = 1 once the SQL pair lands.
  ('collections_subscription', 'Collections Subscription', 'crm',
   'collections_subscription.extract.sql', 'collections_subscription.transform.sql',
   'ie_stg_collections_subscription', 'ie_fact_collections_subscription',
   'FULL_RELOAD_WINDOW', 15, 0, 1440, '2-5', 0)
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

-- ── Dataset freshness monitors (Admin -> Monitoring). daily_fact for the two
-- event-grain incremental facts (touch/recovery have per-day volume to baseline);
-- run_recency for the nightly full-reload facts (task/invoice/subscription). ───────
INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `expected_by_hour`, `cadence_minutes`,
   `arrears_days`, `business_days_only`, `baseline_lookback_days`, `warn_pct`, `red_pct`,
   `min_expected_rows`, `zero_is_red`, `is_active`)
VALUES
  ('collections_task', 'Collections Task', 'source_report', 'source-collections_task', 'run_recency',
   'ie_fact_collections_task', NULL, NULL, 7, 1440, 0, 0, 56, 50.00, 15.00, 0, 0, 1),
  ('collections_invoice', 'Collections Invoice', 'source_report', 'source-collections_invoice', 'run_recency',
   'ie_fact_collections_invoice', NULL, NULL, 7, 1440, 0, 0, 56, 50.00, 15.00, 0, 0, 1),
  ('collections_touch', 'Collections Touch', 'source_report', 'source-collections_touch', 'run_recency',
   'ie_fact_collections_touch', NULL, NULL, 7, 60, 0, 0, 56, 50.00, 15.00, 0, 0, 1),
  ('collections_recovery', 'Collections Recovery', 'source_report', 'source-collections_recovery', 'run_recency',
   'ie_fact_collections_recovery', NULL, NULL, 7, 60, 0, 0, 56, 50.00, 15.00, 0, 0, 1),
  ('collections_subscription', 'Collections Subscription', 'source_report', 'source-collections_subscription', 'run_recency',
   'ie_fact_collections_subscription', NULL, NULL, 7, 1440, 0, 0, 56, 50.00, 15.00, 0, 0, 0)
ON DUPLICATE KEY UPDATE
  `display_name`   = VALUES(`display_name`),
  `producer_kind`  = VALUES(`producer_kind`),
  `producer_ref`   = VALUES(`producer_ref`),
  `check_kind`     = VALUES(`check_kind`),
  `fact_table`     = VALUES(`fact_table`),
  `date_column`    = VALUES(`date_column`),
  `date_kind`      = VALUES(`date_kind`);
