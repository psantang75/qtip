-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · Tickets & Tasks — drop unused KPIs
--
-- The Tickets & Tasks report now shows only the grouped "Tickets and Tasks by
-- Agent" table (no KPI cards). Remove the four ticket KPIs that are no longer
-- surfaced anywhere. No schema change.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM ie_kpi_threshold WHERE kpi_id IN (
  SELECT id FROM ie_kpi WHERE kpi_code IN (
    'aa_tickets_created', 'aa_tickets_closed', 'aa_tickets_open', 'aa_tickets_past_due'
  )
);

DELETE FROM ie_kpi WHERE kpi_code IN (
  'aa_tickets_created', 'aa_tickets_closed', 'aa_tickets_open', 'aa_tickets_past_due'
);
