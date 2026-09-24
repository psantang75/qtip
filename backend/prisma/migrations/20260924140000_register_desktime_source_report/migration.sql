-- Register DeskTime on Admin > Insights > Report Schedules so its cadence is
-- edited and "Run now" is triggered like every other source report.
--
-- DeskTime is an API feed, not a SQL extract: SourceReportDispatcher routes
-- report_code 'desktime_daily' to DeskTimeSyncWorker (workers/apiSourceReports).
-- source_pool, extract_sql_file and staging_table are required by the registry
-- but are never read for this row. incremental_days = how many ET days back
-- each run re-pulls (2 = today + yesterday).
--
-- ON DUPLICATE KEY leaves an existing row untouched so operator cadence edits
-- survive a re-run.

INSERT INTO `ie_source_report`
  (`report_code`, `report_name`, `source_pool`, `extract_sql_file`, `transform_sql_file`,
   `staging_table`, `target_fact_table`, `load_mode`, `window_months`, `incremental_days`,
   `frequency_minutes`, `run_only_hours`, `is_active`)
VALUES
  ('desktime_daily', 'DeskTime Activity', 'primary', 'api:desktime', NULL,
   '', 'ie_fact_desktime_daily', 'INCREMENTAL_WINDOW', 0, 2,
   60, NULL, 1)
ON DUPLICATE KEY UPDATE `report_code` = `report_code`;

-- The monitor's producer is now the dispatcher-run worker, same ingestion-log
-- name ('desktime-sync'); mark it as a source report so failures alert on the
-- SQL-pipeline channel alongside the other Report Schedules rows.
UPDATE `ie_dataset_monitor`
   SET `producer_kind` = 'source_report'
 WHERE `dataset_code` = 'desktime_daily';
