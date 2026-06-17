-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · Tickets & Tasks — drop unused KPI
--
-- The Tickets & Tasks report no longer surfaces "Avg Days to Close" (the KPI
-- card and trend chart were removed; the page is now a single grouped table of
-- Current / Due Today / Past Due counts). Remove the orphaned KPI. No schema
-- change.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM ie_kpi_threshold WHERE kpi_id IN (
  SELECT id FROM ie_kpi WHERE kpi_code = 'aa_avg_days_to_close'
);

DELETE FROM ie_kpi WHERE kpi_code = 'aa_avg_days_to_close';
