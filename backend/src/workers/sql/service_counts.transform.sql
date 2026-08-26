/* Service Counts transform (primary pool): ie_stg_service_counts -> ie_fact_service_counts.
   Load mode FULL_RELOAD_WINDOW with a full-history window (window_months spans
   back past 2006), so the delete window covers every fact month and the re-insert
   refreshes the whole series each run — idempotent, never double-counts.
   date_key is the first of the month (YYYYMM01) so it conforms to ie_dim_date and
   partitions on (date_key DIV 100) = YYYYMM like every other fact.
   NOTE: statements use block comments only — the worker's splitter discards any
   statement that begins with a line comment. */
DELETE FROM ie_fact_service_counts
WHERE date_key BETWEEN CAST(DATE_FORMAT(:pFromDate, '%Y%m%d') AS UNSIGNED)
                   AND CAST(DATE_FORMAT(:pToDate,   '%Y%m%d') AS UNSIGNED);

INSERT INTO ie_fact_service_counts
  (date_key, `year_month`, provider_bucket_id, segment_key,
   started, stopped, active_total, reactivated, load_batch_id)
SELECT
  CAST(CONCAT(s.`year_month`, '01') AS UNSIGNED),
  s.`year_month`,
  s.provider_bucket_id,
  s.segment_key,
  IFNULL(s.started, 0),
  IFNULL(s.stopped, 0),
  IFNULL(s.active_total, 0),
  IFNULL(s.reactivated, 0),
  CONCAT('service_counts:', :pFromDate, '..', :pToDate)
FROM ie_stg_service_counts s
WHERE s.segment_key IS NOT NULL;
