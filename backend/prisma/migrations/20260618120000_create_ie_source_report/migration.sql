-- ─────────────────────────────────────────────────────────────────────────────
-- ie_source_report — registry + scheduler for automated source-report ingestion
--
-- Each row describes one report pulled from a source system (CRM / phone) into
-- the Insights Engine. Adding a new report is data: insert a row + drop two SQL
-- files (extract + transform) into backend/src/workers/sql/. No new worker class.
--
-- Scheduling is DB-driven: a single PM2 dispatcher (ie-source-dispatch) ticks on
-- a fixed floor and runs any report whose `next_run_at` is due. Cadence is tuned
-- per report by editing `frequency_minutes` / `run_only_hours` — no redeploy.
--
-- Purely additive: creates one new table, touches nothing existing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `ie_source_report` (
  `id`                 INT           NOT NULL AUTO_INCREMENT,
  `report_code`        VARCHAR(50)   NOT NULL,
  `report_name`        VARCHAR(100)  NOT NULL,
  -- Which read-only source pool the extract SQL runs against (see config/database.ts)
  `source_pool`        ENUM('crm','phone','primary') NOT NULL,
  -- Extract runs on `source_pool` -> staging; transform runs on primary: staging -> fact.
  `extract_sql_file`   VARCHAR(200)  NOT NULL,
  `transform_sql_file` VARCHAR(200)  NULL,
  `staging_table`      VARCHAR(100)  NOT NULL,
  `target_fact_table`  VARCHAR(100)  NOT NULL,
  -- INCREMENTAL_WINDOW: re-pull trailing `incremental_days`, delete that window in fact then insert.
  -- FULL_RELOAD_WINDOW: rebuild trailing `window_months`, delete window then insert.
  -- SNAPSHOT:           reload the current working set (delete-all-for-set then insert).
  `load_mode`          ENUM('INCREMENTAL_WINDOW','FULL_RELOAD_WINDOW','SNAPSHOT') NOT NULL,
  `window_months`      SMALLINT      NOT NULL DEFAULT 24,
  `incremental_days`   SMALLINT      NOT NULL DEFAULT 14,
  -- Scheduling
  `frequency_minutes`  INT           NOT NULL DEFAULT 60,
  -- Optional off-peak gate, inclusive hour range in server tz, e.g. '0-5'. NULL = any hour.
  `run_only_hours`     VARCHAR(20)   NULL,
  `is_active`          BOOLEAN       NOT NULL DEFAULT FALSE,
  `last_run_at`        DATETIME      NULL,
  `next_run_at`        DATETIME      NULL,
  `last_status`        ENUM('SUCCESS','PARTIAL','FAILED') NULL,
  `created_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_source_report_code` (`report_code`),
  INDEX `idx_source_report_due` (`is_active`, `next_run_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
