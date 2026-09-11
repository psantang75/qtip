-- ─────────────────────────────────────────────────────────────────────────────
-- Support Call facts + the "Call Length" page for Agent Activity - CSR.
--
-- WHY THIS EXISTS: ie_fact_call_activity is a daily (agent x direction)
-- aggregate, so it can say an agent handled 94 calls averaging 3.4 minutes but
-- it cannot say how many of those ran past 10 minutes. A handle-time
-- DISTRIBUTION needs call grain, which is why this lands one row per
-- conversation x agent leg rather than extending the existing daily fact.
--
-- Grain and measures mirror ie_fact_collections_call (the existing call-grain
-- phone fact); the added columns are the handle-time components the
-- distribution is built from:
--   talk_secs   = Genesys segment 'Interact'
--   hold_secs   = segment 'Hold'
--   wrap_secs   = segment 'Wrapup'  (after-call work)
--   handle_secs = talk + hold + wrap, the bucketed measure
-- ie_fact_call_activity.call_mins deliberately excludes wrap; this fact keeps
-- the components separate so wrap can be reported on its own. That matters
-- because roughly half of support calls end with wrap_up_code
-- 'ININ-WRAP-UP-TIMEOUT' and carry ~90s of wrap against ~17s on dispositioned
-- calls, i.e. a large share of handle time is the wrap-up screen timing out
-- rather than customer contact. wrap_up_code is carried so that is measurable.
--
-- The bucket boundaries are NOT stored: the read layer derives them from
-- handle_secs so they can be retuned without reloading the fact.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Staging ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ie_stg_support_call` (
  `conversation_id`   VARCHAR(64)   NULL,
  `phone_user_id`     VARCHAR(64)   NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `agent_name`        VARCHAR(120)  NULL,
  `call_date`         DATE          NULL,
  `started_on`        DATETIME      NULL,           -- ET wall time, as Genesys stores it
  `direction`         VARCHAR(10)   NULL,           -- Inbound / Outbound / Internal
  `talk_secs`         INT           NULL,
  `hold_secs`         INT           NULL,
  `wrap_secs`         INT           NULL,
  `handle_secs`       INT           NULL,
  `wrap_up_code`      VARCHAR(64)   NULL,
  `transferred`       TINYINT       NULL,
  KEY `idx_stg_sc_conv` (`conversation_id`),
  KEY `idx_stg_sc_date` (`call_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`call_date`) * 100 + MONTH(`call_date`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── 2. Fact ──────────────────────────────────────────────────────────────────
-- idx_fsc_handle backs the bucket aggregation, which always filters on
-- date_key and then groups on handle_secs.
CREATE TABLE IF NOT EXISTS `ie_fact_support_call` (
  `support_call_key`  BIGINT        NOT NULL AUTO_INCREMENT,
  `date_key`          INT           NOT NULL,       -- call date YYYYMMDD (ET)
  `conversation_id`   VARCHAR(64)   NOT NULL,
  `phone_user_id`     VARCHAR(64)   NOT NULL,
  `employee_key`      BIGINT        NULL,
  `agent_email`       VARCHAR(255)  NULL,
  `agent_name`        VARCHAR(120)  NULL,
  `started_on`        DATETIME      NULL,
  `direction`         VARCHAR(10)   NOT NULL DEFAULT 'Inbound',
  `talk_secs`         INT           NOT NULL DEFAULT 0,
  `hold_secs`         INT           NOT NULL DEFAULT 0,
  `wrap_secs`         INT           NOT NULL DEFAULT 0,
  `handle_secs`       INT           NOT NULL DEFAULT 0,
  `wrap_up_code`      VARCHAR(64)   NULL,
  `transferred`       TINYINT       NOT NULL DEFAULT 0,
  `load_batch_id`     VARCHAR(80)   NULL,
  `loaded_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`support_call_key`, `date_key`),
  UNIQUE KEY `uq_fsc_conv` (`date_key`, `conversation_id`, `phone_user_id`),
  KEY `idx_fsc_emp` (`employee_key`),
  KEY `idx_fsc_date` (`date_key`),
  KEY `idx_fsc_handle` (`date_key`, `handle_secs`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- ── 3. Registry row ──────────────────────────────────────────────────────────
-- Same cadence as call_activity (hourly, 14-day re-look) because it reads the
-- same conversations from the same pool. A completed conversation never
-- changes, so the window only has to cover legs that land late.
--
-- The extract does NOT pre-filter on tblPhoneUser.DeptID. call_activity's
-- extract filters DeptID IN ('Sales','Billing/CS'), which would silently drop
-- Tech Support (whose DeptID is literally 'Tech Support' for 2 users, with 12
-- more NULL). Department scoping is applied at the READ layer via
-- ie_dim_employee instead — the same choice collections_task made.
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  -- Named for the report it feeds ("Call Length"), not the fact table, so the
  -- Report Schedules row and the Insights page read the same.
  ('support_call', 'Call Length', 'phone',
   'support_call.extract.sql', 'support_call.transform.sql',
   'ie_stg_support_call', 'ie_fact_support_call',
   'INCREMENTAL_WINDOW', 15, 14, 60, NULL, 1)
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
  `is_active`          = VALUES(`is_active`);

-- ── 4. Monitoring ────────────────────────────────────────────────────────────
-- daily_fact on date_key, matching the sibling call_activity monitor: a support
-- department with no calls on a business day is a real problem worth alerting
-- on, so the volume baseline applies.
INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `cadence_minutes`, `arrears_days`, `is_active`)
VALUES
  ('support_call', 'Call Length', 'source_report', 'source-support_call', 'daily_fact',
   'ie_fact_support_call', 'date_key', 'date_key', 60, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`    = VALUES(`display_name`),
  `producer_kind`   = VALUES(`producer_kind`),
  `producer_ref`    = VALUES(`producer_ref`),
  `check_kind`      = VALUES(`check_kind`),
  `fact_table`      = VALUES(`fact_table`),
  `date_column`     = VALUES(`date_column`),
  `date_kind`       = VALUES(`date_kind`),
  `cadence_minutes` = VALUES(`cadence_minutes`),
  `arrears_days`    = VALUES(`arrears_days`),
  `is_active`       = VALUES(`is_active`);

-- ── 5. Page catalog ──────────────────────────────────────────────────────────
-- Sits directly below Call Activity (sort_order 5) in the sidebar group. The
-- group comes from ie_page.category; visibility comes entirely from
-- ie_page_role_access, mirroring the csr_call seed.
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('csr_call_length', 'Call Length',
   'Distribution of handle time by length bucket, per agent and department.',
   'Agent Activity - CSR', '/app/insights/csr-call-length', 'BarChart3', 6, TRUE, 'insights');

-- Role grants mirror csr_call exactly. 1=Admin, 2=QA, 3=CSR, 4=Trainer,
-- 5=Manager. There is no Director role row, so no Director grant is attempted.
INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_call_length' UNION ALL
SELECT id, 5, TRUE, 'ALL'  FROM `ie_page` WHERE `page_key`='csr_call_length' UNION ALL
SELECT id, 2, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_call_length' UNION ALL
SELECT id, 3, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_call_length' UNION ALL
SELECT id, 4, TRUE, 'SELF' FROM `ie_page` WHERE `page_key`='csr_call_length';
