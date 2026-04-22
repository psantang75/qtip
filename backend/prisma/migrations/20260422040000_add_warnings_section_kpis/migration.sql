-- Add per-section KPI rows so every visualization on the Performance Warnings
-- page is backed by its own row in `ie_kpi`, mirroring what was done for
-- Quality (20260421140000_add_quality_section_kpis) and Coaching
-- (20260422030000_add_coaching_section_kpis). Previously these sections had
-- no info popover at all because they had no KPI in the registry to point
-- the (i) icon at.
--
-- All seven KPIs are `DERIVED` because the page renders them as aggregates /
-- views over write_ups + related tables — the calculation engine in
-- QCKpiService does NOT produce a scalar value for any of them. They live
-- in the registry so admins can edit description / formula / source from
-- /app/admin/insights/kpis and have it surface in the section tooltips.
--
-- No schema change — only INSERTs into the existing `ie_kpi` table.

INSERT INTO ie_kpi
  (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order)
VALUES
  ('warnings_status_pipeline', 'Warnings Status Pipeline',
   'Performance warnings created in the period grouped by status (Draft, Scheduled, Awaiting Signature, Signed, Follow-Up Pending, Closed). The total at the bottom is the count of all active write-ups in the period across every status.',
   'Discipline', 'DERIVED',
   'COUNT(write_ups) GROUP BY status WHERE created_at IN range',
   'write_ups',
   'NUMBER', 0, 'NEUTRAL', 1, 70),

  ('warnings_type_distribution', 'Warnings Type Distribution',
   'Mix of performance warnings issued in the period by severity tier (Verbal, Written, Final). Each row shows the count and its share of all warnings, plus a bar relative to the total. Bottom rows surface average days to closure, pending follow-ups, and overdue follow-ups.',
   'Discipline', 'DERIVED',
   'COUNT(write_ups) GROUP BY discipline_type WHERE created_at IN range; AVG/COUNT for follow-up rollups',
   'write_ups',
   'NUMBER', 0, 'NEUTRAL', 1, 71),

  ('warnings_active_list', 'Active Performance Warnings',
   'List of every performance warning that is still active in the period (not CLOSED). Shows the agent, department, severity tier, current status, key dates, prior warning count, and the policies cited. Click an agent to open their profile.',
   'Discipline', 'DERIVED',
   'SELECT write_ups WHERE status != ''CLOSED'' AND created_at IN range, joined to users / departments / policies',
   'write_ups, users, departments, write_up_policies',
   'NUMBER', 0, 'NEUTRAL', 1, 72),

  ('warnings_escalation_path', 'Escalation Path',
   'Snapshot of how many agents currently sit at each severity tier (Verbal → Written → Final) and rolls up the related rate KPIs (Escalation Rate, Repeat Offender Rate, Agents on Final Warning). Helps spot when discipline is concentrating at a single tier.',
   'Discipline', 'DERIVED',
   'COUNT(distinct user_id) GROUP BY discipline_type over write_ups in range; mirrors escalation_rate and repeat_offender_rate KPI values',
   'write_ups, users',
   'NUMBER', 0, 'NEUTRAL', 1, 73),

  ('warnings_repeat_agents', 'Repeat Warning Agents',
   'Agents in the period who already had a prior performance warning on file when their current write-up was created. Shows the agent, department, severity tier, current status, and prior warning count. Sorted by prior warning count descending.',
   'Discipline', 'DERIVED',
   'SELECT write_ups WHERE prior_count > 0 AND created_at IN range, joined to users / departments',
   'write_ups, write_up_prior_discipline, users, departments',
   'NUMBER', 0, 'DOWN_IS_GOOD', 1, 74),

  ('warnings_top_policies', 'Most Violated Policies',
   'Policies cited most often on performance warnings during the period, ranked by violation count. Each row shows the policy, total violations, the number of distinct agents involved, and a bar relative to the most-cited policy. Expand a row to see the agents and their warning details.',
   'Discipline', 'DERIVED',
   'COUNT(write_up_policies) GROUP BY policy, ranked DESC over write_ups in range',
   'write_ups, write_up_policies, users, departments',
   'NUMBER', 0, 'DOWN_IS_GOOD', 1, 75),

  ('warnings_dept_comparison', 'Department Performance Warning Comparison',
   'Per-department warning activity for the period: total warnings issued, warnings closed, and resolution rate. Status colors compare each department''s resolution rate against the writeup_resolution_rate goal. Click a row to focus filters on that department.',
   'Discipline', 'DERIVED',
   'COUNT(write_ups), COUNT(closed), closed/total*100 GROUP BY department_id over write_ups in range',
   'write_ups, departments, users',
   'PERCENT', 1, 'UP_IS_GOOD', 1, 76);
