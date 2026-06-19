-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · Leads — pace KPIs
--
-- Additive: registers the two pace metrics shown on the Leads report (Lead
-- Pace, Conversion Pace) so every metric on the page is backed by an editable
-- row in the KPI engine. No schema change.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
('aa_lead_pace',       'Lead Pace',       'Projected total leads for the full period based on the run rate through the business days elapsed so far.',       'Agent Activity', 'DERIVED', '(total_leads / business_days_elapsed) * business_days_in_period',       'lead / sales margin (source CRM), business calendar', 'NUMBER', 0, 'UP_IS_GOOD', 1, 117),
('aa_conversion_pace', 'Conversion Pace', 'Projected total conversions for the full period based on the run rate through the business days elapsed so far.', 'Agent Activity', 'DERIVED', '(total_conversions / business_days_elapsed) * business_days_in_period', 'lead / sales margin (source CRM), business calendar', 'NUMBER', 0, 'UP_IS_GOOD', 1, 118);
