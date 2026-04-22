-- Add per-section KPI rows so every visualization on the Quality page is
-- backed by its own row in `ie_kpi`. Previously, sections like "Category
-- Performance", "Score Distribution", "Average Score by Form", "Top Missed
-- Questions", and "Department Comparison" were borrowing `avg_qa_score` (or
-- nothing at all) for their tooltips, which violates the rule that every
-- distinct on-page metric must be editable through the KPI registry.
--
-- All five KPIs are `DERIVED` because the page computes them as aggregates /
-- views of the underlying scoring data — the calculation engine in
-- QCKpiService does NOT produce a scalar value for any of them. They exist
-- in the registry so admins can edit description / formula / source from
-- /app/admin/insights/kpis and have it surface in the section tooltips.
--
-- No schema change — only INSERTs into the existing `ie_kpi` table.

INSERT INTO ie_kpi
  (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order)
VALUES
  ('category_performance', 'Category Performance',
   'Average score per scoring category, calculated from the actual question answers (YES/NO, SCALE, RADIO) on every finalized audit in the period. Sorted by lowest score first so the weakest categories surface; defaults to the bottom 5. Trend compares against the prior period; vs Goal compares against the QA score goal.',
   'Quality', 'DERIVED',
   'AVG(question score) per category, computed across finalized submissions in range; vs prior period and vs avg_qa_score goal',
   'submission_answers, form_questions, form_question_categories',
   'PERCENT', 1, 'UP_IS_GOOD', 1, 50),

  ('score_distribution', 'Score Distribution',
   'Finalized audits in the period bucketed by total score (90-100, 80-89, 70-79, 60-69, Below 60). Each row shows the audit count and its share of the total. Bars at or above the QA score goal are highlighted; bars below the goal are gray. Score uses COALESCE(submissions.total_score, score_snapshots.score). Only audits with a CSR assigned via form metadata are included. Honors the active Department and Form filters.',
   'Quality', 'DERIVED',
   'COUNT(submissions) bucketed by COALESCE(total_score, score_snapshot.score) over finalized audits in range',
   'submissions, score_snapshots, submission_metadata',
   'NUMBER', 0, 'NEUTRAL', 1, 51),

  ('avg_score_by_form', 'Average Score by Form',
   'Per-form submission count and average total score for the period. vs Goal compares each form''s average against the QA score goal. Click a row to drill in by adding/removing that form from the Form filter. Honors the active Department filter.',
   'Quality', 'DERIVED',
   'AVG(total_score) and COUNT(submissions) GROUP BY form_id over finalized audits in range',
   'submissions, forms',
   'PERCENT', 1, 'UP_IS_GOOD', 1, 52),

  ('top_missed_questions', 'Top Missed Questions',
   'Up to 10 scoring questions (YES/NO, SCALE, RADIO) with the highest miss rate in the period. A question is "missed" when it was scoreable but the answer earned 0 points. Only questions answered on at least 5 audits are shown. Expand a row to see the agents who missed it most. Honors the active Department and Form filters.',
   'Quality', 'DERIVED',
   'COUNT(answers WHERE points = 0) / COUNT(answers) per question_id, ranked DESC, limited to top 10 with at least 5 answers',
   'submission_answers, form_questions',
   'PERCENT', 1, 'DOWN_IS_GOOD', 1, 53),

  ('dept_comparison', 'Department Comparison',
   'Per-department audit count, average QA score, and dispute count for the selected period. Status compares each department''s average against the QA score goal. Click a row to focus filters on that department.',
   'Quality', 'DERIVED',
   'AVG(total_score), COUNT(submissions), COUNT(disputes) GROUP BY department_id over finalized audits in range',
   'submissions, departments, disputes, submission_metadata',
   'PERCENT', 1, 'UP_IS_GOOD', 1, 54);
