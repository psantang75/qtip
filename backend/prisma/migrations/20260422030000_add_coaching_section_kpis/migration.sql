-- Add per-section KPI rows so every visualization on the Coaching page is
-- backed by its own row in `ie_kpi`, mirroring what was done for Quality in
-- migration 20260421140000_add_quality_section_kpis. Previously these
-- sections either had no info popover at all (Coaching Sessions by Status,
-- Repeat Coaching, Most Coached Topics, Quiz Performance, Department
-- Coaching Comparison) or borrowed an underlying tile KPI for the tooltip,
-- which makes them un-editable as standalone visualizations.
--
-- All five KPIs are `DERIVED` because the page renders them as aggregates /
-- views over the underlying coaching tables — the calculation engine in
-- QCKpiService does NOT produce a scalar value for any of them. They live
-- in the registry so admins can edit description / formula / source from
-- /app/admin/insights/kpis and have it surface in the section tooltips.
--
-- No schema change — only INSERTs into the existing `ie_kpi` table.

INSERT INTO ie_kpi
  (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order)
VALUES
  ('coaching_status_distribution', 'Coaching Sessions by Status',
   'Coaching sessions in the period grouped by status (Scheduled, In Process, Awaiting CSR Action, Quiz Pending, Completed, Follow-Up Required, Closed). Each row shows the session count, the number of unique agents involved, and a bar relative to the largest status bucket. Expand a row to see the agents and their topics.',
   'Coaching', 'DERIVED',
   'COUNT(coaching_sessions) GROUP BY status; per-row UNIQUE agents and topics over sessions in range',
   'coaching_sessions, users, departments',
   'NUMBER', 0, 'NEUTRAL', 1, 60),

  ('coaching_repeat_offenders', 'Repeat Coaching',
   'Agents who received more than one coaching session in the period. Shows the agent, department, total sessions, and a sparkline of session activity. Expand a row to see the individual sessions, topics, and statuses. Sorted by session count descending.',
   'Coaching', 'DERIVED',
   'COUNT(coaching_sessions) GROUP BY user_id HAVING COUNT(*) > 1, ranked DESC over sessions in range',
   'coaching_sessions, users, departments',
   'NUMBER', 0, 'DOWN_IS_GOOD', 1, 61),

  ('coaching_top_topics', 'Most Coached Topics',
   'Coaching topics that came up most often during the period, ranked by session count. Defaults to the top 5; click to expand to see which agents were coached on that topic. Drill into an agent profile by clicking their name.',
   'Coaching', 'DERIVED',
   'COUNT(coaching_session_topics) GROUP BY topic, ranked DESC over sessions in range',
   'coaching_sessions, coaching_session_topics',
   'NUMBER', 0, 'NEUTRAL', 1, 62),

  ('coaching_quiz_performance', 'Quiz Performance',
   'Roll-up of quiz activity tied to coaching: total quizzes assigned, passed, pass rate, average score, and average attempts to pass. The breakdown table lists each quiz with attempts, passes, and miss rate; sorted by misses desc. Expand a row for the agents who failed it most.',
   'Coaching', 'DERIVED',
   'AGGREGATE(quiz_attempts) per quiz over period; tile values mirror quizzes_assigned, quizzes_passed, quiz_pass_rate, avg_quiz_score, avg_attempts_to_pass',
   'quiz_attempts, quizzes, users',
   'NUMBER', 0, 'NEUTRAL', 1, 63),

  ('coaching_dept_comparison', 'Department Coaching Comparison',
   'Per-department coaching activity for the period: total sessions, completed, completion %, and average days to close. Status compares each department''s completion against the coaching_completion_rate goal. Click a row to focus filters on that department.',
   'Coaching', 'DERIVED',
   'COUNT(sessions), COUNT(completed), AVG(DATEDIFF(completed_at, created_at)) GROUP BY department_id over sessions in range',
   'coaching_sessions, departments, users',
   'PERCENT', 1, 'UP_IS_GOOD', 1, 64);
