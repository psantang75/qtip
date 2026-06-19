-- Phase 3 (Tickets & Tasks): shared staging + fact table and the two
-- ie_source_report registry rows (ticket_open + task_open) that drive ingestion
-- via the SourceReportDispatcher. The legacy proc UNIONed both halves in one
-- ~22s statement (too close to the 25s per-session cap), so it is split into two
-- SNAPSHOT reports that both load ie_fact_ticket_task; each runs well under cap.
-- IF NOT EXISTS / ON DUPLICATE KEY keep this idempotent (apply now, re-run later
-- by `prisma migrate deploy`).

-- Shared staging: raw extract landing zone, TRUNCATEd at the start of each run.
-- Columns MUST match the extract SELECT aliases exactly (worker inserts by name).
-- The dispatcher runs reports sequentially, so ticket_open and task_open never
-- collide on this table. Partitioned on created_on's YYYYMM so the
-- PartitionManagerWorker manages it without erroring (NULLs fall into p_future).
CREATE TABLE IF NOT EXISTS `ie_stg_ticket_task` (
  `process_type`       VARCHAR(10)   NULL,
  `customer_id`        INT           NULL,
  `customer_name`      VARCHAR(200)  NULL,
  `task_id`            INT           NULL,
  `ticket_id`          INT           NULL,
  `classification`     VARCHAR(150)  NULL,
  `sub_classification` VARCHAR(150)  NULL,
  `email`              VARCHAR(255)  NULL,
  `assigned_to`        VARCHAR(150)  NULL,
  `dept`               VARCHAR(100)  NULL,
  `status`             VARCHAR(100)  NULL,
  `created_on`         DATETIME      NULL,
  `next_contact`       DATETIME      NULL,
  `last_touched_on`    DATETIME      NULL,
  `last_touched_by`    VARCHAR(150)  NULL,
  `closed_on`          DATETIME      NULL,
  `closed_by`          VARCHAR(150)  NULL,
  `crm_url`            VARCHAR(255)  NULL,
  KEY `idx_stg_tt_email` (`email`),
  KEY `idx_stg_tt_type`  (`process_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(`created_on`) * 100 + MONTH(`created_on`)) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Fact: SNAPSHOT grain = one row per open work item (Ticket or Task).
-- date_key is the snapshot day (YYYYMMDD); the report has no historical grain,
-- so it exists only to partition on (date_key DIV 100) = YYYYMM, lining up with
-- PartitionManagerWorker's boundaries. Current/Due Today/Past Due buckets are
-- derived at READ time from next_contact vs NOW(), so they never go stale.
CREATE TABLE IF NOT EXISTS `ie_fact_ticket_task` (
  `ticket_task_key`    BIGINT        NOT NULL AUTO_INCREMENT,
  `date_key`           INT           NOT NULL,
  `employee_key`       INT           NULL,
  `agent_email`        VARCHAR(255)  NULL,
  `agent_name`         VARCHAR(150)  NULL,
  `process_type`       VARCHAR(10)   NOT NULL DEFAULT '',
  `task_id`            INT           NOT NULL DEFAULT 0,
  `ticket_id`          INT           NOT NULL DEFAULT 0,
  `customer_id`        INT           NULL,
  `customer_name`      VARCHAR(200)  NULL,
  `classification`     VARCHAR(150)  NULL,
  `sub_classification` VARCHAR(150)  NULL,
  `dept`               VARCHAR(100)  NULL,
  `status`             VARCHAR(100)  NULL,
  `created_on`         DATETIME      NULL,
  `next_contact`       DATETIME      NULL,
  `last_touched_on`    DATETIME      NULL,
  `last_touched_by`    VARCHAR(150)  NULL,
  `closed_on`          DATETIME      NULL,
  `closed_by`          VARCHAR(150)  NULL,
  `crm_url`            VARCHAR(255)  NULL,
  `load_batch_id`      VARCHAR(80)   NULL,
  `loaded_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ticket_task_key`, `date_key`),
  KEY `idx_ftt_date`  (`date_key`),
  KEY `idx_ftt_emp`   (`employee_key`),
  KEY `idx_ftt_type`  (`process_type`),
  KEY `idx_ftt_class` (`classification`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (`date_key` DIV 100) (
  PARTITION `p_future` VALUES LESS THAN MAXVALUE
);

-- Registry rows: crm-source SNAPSHOT, 2-month recently-closed tail, every 2h.
-- window_months feeds the proc's :pMonths. Retune frequency_minutes per row
-- later (no redeploy). incremental_days is unused for SNAPSHOT (kept 0).
INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('ticket_open', 'Tickets (Open)', 'crm',
   'ticket_open.extract.sql', 'ticket_open.transform.sql',
   'ie_stg_ticket_task', 'ie_fact_ticket_task',
   'SNAPSHOT', 2, 0, 120, NULL, 1),
  ('task_open', 'Tasks (Open)', 'crm',
   'task_open.extract.sql', 'task_open.transform.sql',
   'ie_stg_ticket_task', 'ie_fact_ticket_task',
   'SNAPSHOT', 2, 0, 120, NULL, 1)
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
