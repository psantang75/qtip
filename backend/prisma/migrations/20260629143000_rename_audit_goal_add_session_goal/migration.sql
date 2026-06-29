-- Rename the `audits_assigned` KPI display name to "Audit Goal" and register
-- the new coaching "Sessions Goal" KPI (one coaching session per active agent
-- per week, scoped to the agents in the selected departments).
--
-- Additive + idempotent: no schema changes. The runtime value is computed in
-- backend/src/services/QCKpiService.ts; this row only feeds the read-only
-- Insights KPI registry and the live name/description/source overlay.

UPDATE ie_kpi
SET kpi_name = 'Audit Goal'
WHERE kpi_code = 'audits_assigned';

INSERT INTO ie_kpi
  (kpi_code, kpi_name, description, category, formula_type, formula, source_table,
   format_type, decimal_places, direction, is_active, sort_order)
VALUES
  ('coaching_session_goal', 'Sessions Goal',
   'Target number of coaching sessions for the period — one session per active agent per week. The agent count honors the active Department filter; the number of weeks is derived from the business calendar (business days ÷ 5).',
   'Coaching', 'DERIVED',
   'active_agents (in selected departments) × (business_days_in_period ÷ 5), rounded',
   'users, business_calendar_days',
   'NUMBER', 0, 'NEUTRAL', 1, 0)
ON DUPLICATE KEY UPDATE
  kpi_name       = VALUES(kpi_name),
  description    = VALUES(description),
  category       = VALUES(category),
  formula_type   = VALUES(formula_type),
  formula        = VALUES(formula),
  source_table   = VALUES(source_table),
  format_type    = VALUES(format_type),
  decimal_places = VALUES(decimal_places),
  direction      = VALUES(direction),
  is_active      = VALUES(is_active),
  sort_order     = VALUES(sort_order);
