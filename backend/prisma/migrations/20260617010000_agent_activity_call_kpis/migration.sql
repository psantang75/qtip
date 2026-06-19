-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · Call Activity KPI refinements
--
-- Additive: registers 3 new KPIs used by the rebuilt Call Activity report
-- (Business Days, Avg Calls / Day, Avg Min / Day) and renames two existing
-- Call Activity KPIs to match the report labels. No schema change.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
('aa_business_days',     'Business Days',  'Business days in the selected date range, per the Business Calendar. Basis for all per-day averages on the page.', 'Agent Activity', 'DERIVED', 'COUNT(calendar days WHERE is_business_day = true AND calendar_date IN range)', 'business calendar', 'NUMBER', 0, 'NEUTRAL',    1, 100),
('aa_avg_calls_per_day', 'Avg Calls / Day','Total calls divided by the number of business days in the range.',                                              'Agent Activity', 'DERIVED', 'total_calls / business_days',                                                'call activity (source phone system), business calendar', 'NUMBER', 1, 'UP_IS_GOOD', 1, 106),
('aa_avg_min_per_day',   'Avg Min / Day',  'Total talk minutes divided by the number of business days in the range.',                                       'Agent Activity', 'DERIVED', 'total_talk_minutes / business_days',                                         'call activity (source phone system), business calendar', 'NUMBER', 1, 'NEUTRAL',    1, 107);

UPDATE ie_kpi SET kpi_name = 'Total Talk Time' WHERE kpi_code = 'aa_total_talk_minutes';
UPDATE ie_kpi SET kpi_name = 'Avg Min / Call', direction = 'DOWN_IS_GOOD' WHERE kpi_code = 'aa_avg_handle_time';
