-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · Call Activity — inbound/outbound talk-minute KPIs
--
-- Additive: registers the two remaining metrics shown on the Call Activity
-- "by day" detail table (Inbound Min, Outbound Min) so every column on the
-- page is backed by an editable row in the KPI engine. No schema change.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
('aa_inbound_minutes',  'Inbound Min',  'Total talk minutes on inbound calls in the period.',  'Agent Activity', 'DERIVED', 'SUM(call_mins) WHERE call_direction = Inbound',  'call activity (source phone system)', 'NUMBER', 0, 'NEUTRAL', 1, 108),
('aa_outbound_minutes', 'Outbound Min', 'Total talk minutes on outbound calls in the period.', 'Agent Activity', 'DERIVED', 'SUM(call_mins) WHERE call_direction = Outbound', 'call activity (source phone system)', 'NUMBER', 0, 'NEUTRAL', 1, 109);
