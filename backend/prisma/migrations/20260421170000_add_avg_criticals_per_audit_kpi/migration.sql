-- Refresh the existing critical_fail_rate KPI metadata now that it is wired up
-- through the score-cap rule (submissions.score_capped flag persisted by
-- backend/src/utils/scoringUtil.ts).
UPDATE ie_kpi
SET
  description  = 'Percentage of finalized audits where the score-cap rule fired (one or more critical-fail questions were missed and the score was capped to the form''s critical_cap_percent).',
  formula      = 'COUNT(submissions WHERE score_capped = 1) / COUNT(submissions WHERE status = ''FINALIZED'') * 100',
  source_table = 'submissions',
  category     = 'Quality',
  formula_type = 'SQL',
  is_active    = 1
WHERE kpi_code = 'critical_fail_rate';

-- Add the companion KPI: average number of critical-fail questions missed per
-- finalized audit (uses the persisted submissions.critical_fail_count column).
INSERT INTO ie_kpi
  (kpi_code, kpi_name, description, category, formula_type, formula, source_table,
   format_type, decimal_places, direction, is_active, sort_order)
VALUES
  ('avg_criticals_per_audit',
   'Avg Criticals per Audit',
   'Average number of critical-fail questions missed per finalized audit. Counts every critical question answered NO across all finalized audits in the period and divides by the audit count.',
   'Quality', 'SQL',
   'AVG(submissions.critical_fail_count) WHERE status = ''FINALIZED''',
   'submissions',
   'NUMBER', 2, 'DOWN_IS_GOOD', 1, 11)
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
