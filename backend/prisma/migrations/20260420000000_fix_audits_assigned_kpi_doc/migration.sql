-- Fix the documentation fields on the `audits_assigned` KPI so the read-only
-- registry on the Insights KPIs page reflects how the value is actually
-- computed at runtime (see backend/src/services/QCKpiService.ts).
--
-- This migration only updates DOCUMENTATION text and only for one KPI row.
-- It does NOT alter any schema and does NOT change calculation behavior.

UPDATE ie_kpi
SET
  description  = 'Expected number of audits in the selected period. Calculated as the global pace target (audits per business day, set in Thresholds) multiplied by the number of business days in the period.',
  formula      = 'goal_value (Per Business Day) × business_days_in_period (rounded)',
  source_table = 'ie_kpi_threshold, business_calendar_days'
WHERE kpi_code = 'audits_assigned';
