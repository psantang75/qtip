-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · Sales Margin — drop unused KPIs
--
-- The Sales Margin report is now four tables (Leads, Deals & Subscriptions,
-- Margin by Salesperson, Margin by Customer Leaderboard) with no KPI cards.
-- Remove the six margin KPIs that are no longer surfaced anywhere. No schema
-- change.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM ie_kpi_threshold WHERE kpi_id IN (
  SELECT id FROM ie_kpi WHERE kpi_code IN (
    'aa_product_margin', 'aa_warranty_margin', 'aa_total_margin',
    'aa_margin_pace', 'aa_margin_per_deal', 'aa_warranty_close_rate'
  )
);

DELETE FROM ie_kpi WHERE kpi_code IN (
  'aa_product_margin', 'aa_warranty_margin', 'aa_total_margin',
  'aa_margin_pace', 'aa_margin_per_deal', 'aa_warranty_close_rate'
);
