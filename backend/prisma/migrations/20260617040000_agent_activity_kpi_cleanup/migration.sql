-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales · KPI cleanup
--
-- Removes registered KPIs that are no longer used by any page:
--   • Subs trio (aa_total_subs, aa_sub_pace, aa_sub_only_pct) — the Leads report
--     was rebuilt around leads/conversions by category & source, dropping subs.
--   • Per-direction email volume (aa_inbound_emails, aa_outbound_emails,
--     aa_internal_emails, aa_total_emails) — the Email Activity report is now
--     just "Total Sent Emails" tables.
--
-- Adds the single metric the Email page actually surfaces (aa_emails_sent) so it
-- stays backed by the KPI engine. No schema change.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM ie_kpi_threshold WHERE kpi_id IN (
  SELECT id FROM ie_kpi WHERE kpi_code IN (
    'aa_total_subs', 'aa_sub_pace', 'aa_sub_only_pct',
    'aa_inbound_emails', 'aa_outbound_emails', 'aa_internal_emails', 'aa_total_emails'
  )
);

DELETE FROM ie_kpi WHERE kpi_code IN (
  'aa_total_subs', 'aa_sub_pace', 'aa_sub_only_pct',
  'aa_inbound_emails', 'aa_outbound_emails', 'aa_internal_emails', 'aa_total_emails'
);

INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
('aa_emails_sent', 'Total Sent Emails', 'Total emails sent by the agent in the period.', 'Agent Activity', 'DERIVED', 'SUM(email_count) WHERE email_direction = Outbound', 'email stats (source mail system)', 'NUMBER', 0, 'UP_IS_GOOD', 1, 130);
