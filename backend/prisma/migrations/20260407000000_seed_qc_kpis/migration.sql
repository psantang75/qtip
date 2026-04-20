-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 SEED — QC KPI Definitions, Thresholds, Page Registry, and Role Access
-- Run once against the target database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: KPI Definitions (28 total) ───────────────────────────────────────

INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
-- Quality (12)
('avg_qa_score',                'Avg QA Score',            'Average QA score across all finalized submissions.',                          'Quality',    'SQL',     'AVG(total_score) WHERE status = FINALIZED',                         'submission',                        'PERCENT', 1, 'UP_IS_GOOD',   1,  1),
('audits_assigned',             'Audits Assigned',          'Expected audits based on pace targets in KPI thresholds.',                   'Quality',    'DERIVED', 'pace_per_form x weeks_in_period x active_forms',                    'ie_kpi_threshold',                  'NUMBER',  0, 'NEUTRAL',      1,  2),
('audits_completed',            'Audits Completed',         'Total QA audits finalized this period.',                                     'Quality',    'SQL',     'COUNT WHERE status = FINALIZED AND submitted_at IN period',          'submission',                        'NUMBER',  0, 'UP_IS_GOOD',   1,  3),
('audit_completion_rate',       'Audit Completion %',       'Percentage of expected audits completed.',                                   'Quality',    'DERIVED', 'audits_completed / audits_assigned x 100',                          'submission,ie_kpi_threshold',       'PERCENT', 1, 'UP_IS_GOOD',   1,  4),
('dispute_rate',                'Dispute Rate',             'Percentage of finalized submissions disputed.',                              'Quality',    'SQL',     'COUNT(disputes) / COUNT(finalized) x 100',                          'dispute,submission',                'PERCENT', 1, 'DOWN_IS_GOOD', 1,  5),
('dispute_upheld_rate',         'Dispute Upheld Rate',      'Of resolved disputes, percentage upheld in agent favor.',                    'Quality',    'SQL',     'COUNT(UPHELD) / COUNT(resolved) x 100',                             'dispute',                           'PERCENT', 1, 'DOWN_IS_GOOD', 1,  6),
('dispute_not_upheld_rate',     'Dispute Rejected Rate',    'Percentage of resolved disputes rejected.',                                  'Quality',    'SQL',     'COUNT(REJECTED) / COUNT(resolved) x 100',                           'dispute',                           'PERCENT', 1, 'NEUTRAL',      1,  7),
('dispute_adjusted_rate',       'Dispute Adjusted Rate',    'Submissions where dispute led to score adjustment.',                         'Quality',    'SQL',     'COUNT(ADJUSTED) / COUNT(finalized) x 100',                          'dispute,submission',                'PERCENT', 1, 'DOWN_IS_GOOD', 1,  8),
('avg_dispute_resolution_time', 'Avg Resolution Time',      'Average days from dispute creation to resolution.',                          'Quality',    'SQL',     'AVG(resolved_at - created_at) in days',                             'dispute',                           'NUMBER',  1, 'DOWN_IS_GOOD', 1,  9),
('critical_fail_rate',          'Critical Fail Rate',       'Evaluations where an auto-fail question was triggered.',                     'Quality',    'SQL',     'COUNT(auto-fail) / COUNT(submissions) x 100',                       'submission_answer,form_question',   'PERCENT', 1, 'DOWN_IS_GOOD', 1, 10),
('time_to_audit',               'Time to Audit',            'Average days from call date to QA audit completion.',                        'Quality',    'SQL',     'AVG(submitted_at - call_date) in days',                             'submission',                        'NUMBER',  1, 'DOWN_IS_GOOD', 1, 11),
('qa_score_trend',              'QA Score Trend',           'Directional trend of average QA scores over the selected period.',           'Quality',    'DERIVED', 'delta of avg_qa_score vs prior period',                             'submission',                        'PERCENT', 1, 'UP_IS_GOOD',   1, 12),
-- Coaching (8)
('coaching_sessions_assigned',  'Sessions Assigned',        'Expected sessions based on pace targets x active agents x weeks.',          'Coaching',   'DERIVED', 'pace_per_agent x active_agents x weeks_in_period',                  'ie_kpi_threshold,user',             'NUMBER',  0, 'NEUTRAL',      1, 13),
('coaching_sessions_completed', 'Sessions Completed',       'Coaching sessions reaching COMPLETED or CLOSED status.',                     'Coaching',   'SQL',     'COUNT WHERE status IN (COMPLETED,CLOSED) AND completed_at IN period','coaching_session',                 'NUMBER',  0, 'UP_IS_GOOD',   1, 14),
('coaching_completion_rate',    'Coaching Completion %',    'Percentage of expected coaching sessions completed.',                        'Coaching',   'DERIVED', 'sessions_completed / sessions_assigned x 100',                      'coaching_session,ie_kpi_threshold', 'PERCENT', 1, 'UP_IS_GOOD',   1, 15),
('coaching_delivery_rate',      'Coaching Delivery',        'Scheduled sessions that were actually delivered.',                           'Coaching',   'SQL',     'COUNT(delivered_at IS NOT NULL) / COUNT(sessions) x 100',           'coaching_session',                  'PERCENT', 1, 'UP_IS_GOOD',   1, 16),
('coaching_cadence',            'Coaching Cadence',         'Percentage of target sessions delivered based on expected frequency.',       'Coaching',   'DERIVED', 'delivered_sessions / (agents x expected_per_period) x 100',         'coaching_session,ie_kpi_threshold', 'PERCENT', 1, 'UP_IS_GOOD',   1, 17),
('avg_days_to_close_coaching',  'Avg Days to Close',        'Average days from coaching session creation to completion.',                 'Coaching',   'SQL',     'AVG(completed_at - created_at) in days',                            'coaching_session',                  'NUMBER',  1, 'DOWN_IS_GOOD', 1, 18),
('followup_compliance_rate',    'Follow-Up Compliance',     'Sessions requiring follow-up where follow-up was completed on time.',        'Coaching',   'SQL',     'COUNT(on-time) / COUNT(required) x 100',                            'coaching_session',                  'PERCENT', 1, 'UP_IS_GOOD',   1, 19),
('time_to_coaching',            'Time to Coaching',         'Average days from low QA score to coaching session creation.',              'Coaching',   'SQL',     'AVG(coaching.created_at - submission.submitted_at) in days',         'coaching_session,submission',       'NUMBER',  1, 'DOWN_IS_GOOD', 1, 20),
-- Quiz (3)
('quiz_pass_rate',              'Quiz Pass Rate',           'Percentage of quiz attempts resulting in a passing score.',                  'Quiz',       'SQL',     'COUNT(passed=true) / COUNT(attempts) x 100',                        'quiz_attempt',                      'PERCENT', 1, 'UP_IS_GOOD',   1, 21),
('avg_quiz_score',              'Avg Quiz Score',           'Average score across all quiz attempts.',                                    'Quiz',       'SQL',     'AVG(quiz_attempt.score)',                                           'quiz_attempt',                      'PERCENT', 1, 'UP_IS_GOOD',   1, 22),
('avg_attempts_to_pass',        'Avg Attempts to Pass',     'Average quiz attempts before passing.',                                      'Quiz',       'SQL',     'AVG(attempts per quiz until pass)',                                  'quiz_attempt',                      'NUMBER',  1, 'DOWN_IS_GOOD', 1, 23),
-- Discipline (5)
('total_writeups_issued',       'Write-Ups Issued',         'Total write-ups created this period.',                                       'Discipline', 'SQL',     'COUNT WHERE created_at IN period',                                  'write_up',                          'NUMBER',  0, 'DOWN_IS_GOOD', 1, 24),
('writeup_rate',                'Write-Up Rate',            'Write-ups per 100 employees per month.',                                     'Discipline', 'DERIVED', 'COUNT(write_ups) / COUNT(active_employees) x 100',                  'write_up,user',                     'NUMBER',  1, 'NEUTRAL',      1, 25),
('escalation_rate',             'Escalation Rate',          'Write-ups that escalated from verbal to written or written to final.',       'Discipline', 'SQL',     'COUNT(escalated) / COUNT(write_ups) x 100',                         'write_up,write_up_prior_discipline','PERCENT', 1, 'DOWN_IS_GOOD', 1, 26),
('repeat_offender_rate',        'Repeat Offender Rate',     'Agents who receive another write-up within 90 days.',                        'Discipline', 'SQL',     'COUNT(agents with 2+ write-ups in 90 days) / COUNT(agents with write-ups) x 100','write_up','PERCENT',1,'DOWN_IS_GOOD',1,27),
('writeup_resolution_rate',     'Write-Up Resolution',      'Percentage of write-ups reaching CLOSED status.',                            'Discipline', 'SQL',     'COUNT(status=CLOSED) / COUNT(write_ups) x 100',                     'write_up',                          'PERCENT', 1, 'UP_IS_GOOD',   1, 28);

-- ── Step 2: Default Thresholds ────────────────────────────────────────────────

INSERT INTO ie_kpi_threshold (kpi_id, department_key, goal_value, warning_value, critical_value, effective_from)
SELECT id, NULL,
  CASE kpi_code
    WHEN 'avg_qa_score'               THEN 90   WHEN 'audit_completion_rate'      THEN 95
    WHEN 'dispute_rate'               THEN 5    WHEN 'dispute_upheld_rate'        THEN 10
    WHEN 'dispute_adjusted_rate'      THEN 3    WHEN 'avg_dispute_resolution_time' THEN 3
    WHEN 'critical_fail_rate'         THEN 2    WHEN 'time_to_audit'              THEN 3
    WHEN 'coaching_completion_rate'   THEN 92   WHEN 'coaching_delivery_rate'     THEN 95
    WHEN 'coaching_cadence'           THEN 95   WHEN 'avg_days_to_close_coaching' THEN 10
    WHEN 'followup_compliance_rate'   THEN 90   WHEN 'time_to_coaching'           THEN 5
    WHEN 'quiz_pass_rate'             THEN 85   WHEN 'avg_quiz_score'             THEN 82
    WHEN 'avg_attempts_to_pass'       THEN 1.2  WHEN 'escalation_rate'            THEN 15
    WHEN 'repeat_offender_rate'       THEN 10   WHEN 'writeup_resolution_rate'    THEN 90
    ELSE NULL END,
  CASE kpi_code
    WHEN 'avg_qa_score'               THEN 80   WHEN 'audit_completion_rate'      THEN 85
    WHEN 'dispute_rate'               THEN 10   WHEN 'dispute_upheld_rate'        THEN 20
    WHEN 'dispute_adjusted_rate'      THEN 8    WHEN 'avg_dispute_resolution_time' THEN 7
    WHEN 'critical_fail_rate'         THEN 5    WHEN 'time_to_audit'              THEN 7
    WHEN 'coaching_completion_rate'   THEN 80   WHEN 'coaching_delivery_rate'     THEN 85
    WHEN 'coaching_cadence'           THEN 80   WHEN 'avg_days_to_close_coaching' THEN 21
    WHEN 'followup_compliance_rate'   THEN 75   WHEN 'time_to_coaching'           THEN 10
    WHEN 'quiz_pass_rate'             THEN 70   WHEN 'avg_quiz_score'             THEN 70
    WHEN 'avg_attempts_to_pass'       THEN 1.8  WHEN 'escalation_rate'            THEN 25
    WHEN 'repeat_offender_rate'       THEN 20   WHEN 'writeup_resolution_rate'    THEN 75
    ELSE NULL END,
  CASE kpi_code
    WHEN 'avg_qa_score'               THEN 70   WHEN 'audit_completion_rate'      THEN 75
    WHEN 'dispute_rate'               THEN 20   WHEN 'dispute_upheld_rate'        THEN 35
    WHEN 'dispute_adjusted_rate'      THEN 15   WHEN 'avg_dispute_resolution_time' THEN 14
    WHEN 'critical_fail_rate'         THEN 10   WHEN 'time_to_audit'              THEN 14
    WHEN 'coaching_completion_rate'   THEN 65   WHEN 'coaching_delivery_rate'     THEN 70
    WHEN 'coaching_cadence'           THEN 60   WHEN 'avg_days_to_close_coaching' THEN 30
    WHEN 'followup_compliance_rate'   THEN 60   WHEN 'time_to_coaching'           THEN 21
    WHEN 'quiz_pass_rate'             THEN 55   WHEN 'avg_quiz_score'             THEN 60
    WHEN 'avg_attempts_to_pass'       THEN 2.5  WHEN 'escalation_rate'            THEN 40
    WHEN 'repeat_offender_rate'       THEN 35   WHEN 'writeup_resolution_rate'    THEN 60
    ELSE NULL END,
  CURDATE()
FROM ie_kpi WHERE kpi_code IN (
  'avg_qa_score','audit_completion_rate','dispute_rate','dispute_upheld_rate','dispute_adjusted_rate',
  'avg_dispute_resolution_time','critical_fail_rate','time_to_audit','coaching_completion_rate',
  'coaching_delivery_rate','coaching_cadence','avg_days_to_close_coaching','followup_compliance_rate',
  'time_to_coaching','quiz_pass_rate','avg_quiz_score','avg_attempts_to_pass',
  'escalation_rate','repeat_offender_rate','writeup_resolution_rate'
);

-- ── Step 3: Page Registry ─────────────────────────────────────────────────────

INSERT INTO ie_page (page_key, page_name, description, category, route_path, icon, sort_order, is_active, requires_section) VALUES
('qc_overview', 'Overview',             'Quality & Coaching KPI overview, trend charts, and agent leaderboard.',        'Quality, Coaching & Performance Warnings', '/app/insights/qc-overview', 'LayoutDashboard', 1, 1, 'insights'),
('qc_quality',  'Quality Deep Dive',    'Detailed quality analytics: scores, disputes, categories, missed questions.',  'Quality, Coaching & Performance Warnings', '/app/insights/qc-quality',  'Target',          2, 1, 'insights'),
('qc_coaching', 'Coaching',             'Coaching analytics: topics, repeat coaching agents, quiz performance.',        'Quality, Coaching & Performance Warnings', '/app/insights/qc-coaching', 'BookOpen',        3, 1, 'insights'),
('qc_warnings', 'Performance Warnings', 'Write-up tracking, escalation path, policy violations.',                      'Quality, Coaching & Performance Warnings', '/app/insights/qc-warnings', 'AlertTriangle',   4, 1, 'insights'),
('qc_agents',   'Agent Performance',    'Agent list with full drill-through profile for quality, coaching, warnings.',  'Quality, Coaching & Performance Warnings', '/app/insights/qc-agents',   'Users',           5, 1, 'insights');

-- ── Step 4: Role Access ───────────────────────────────────────────────────────
-- Admin(1) and Manager(5) → ALL scope; QA(2) and Trainer(4) → DEPARTMENT scope

INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope)
SELECT p.id, r.role_id, 1, r.data_scope
FROM ie_page p
JOIN (
  SELECT 'qc_overview' pk, 1 role_id, 'ALL'        data_scope UNION ALL
  SELECT 'qc_overview',    2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_overview',    4,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_overview',    5,          'ALL'                    UNION ALL
  SELECT 'qc_quality',     1,          'ALL'                    UNION ALL
  SELECT 'qc_quality',     2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_quality',     5,          'ALL'                    UNION ALL
  SELECT 'qc_coaching',    1,          'ALL'                    UNION ALL
  SELECT 'qc_coaching',    2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_coaching',    4,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_coaching',    5,          'ALL'                    UNION ALL
  SELECT 'qc_warnings',    1,          'ALL'                    UNION ALL
  SELECT 'qc_warnings',    2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_warnings',    5,          'ALL'                    UNION ALL
  SELECT 'qc_agents',      1,          'ALL'                    UNION ALL
  SELECT 'qc_agents',      2,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_agents',      4,          'DEPARTMENT'             UNION ALL
  SELECT 'qc_agents',      5,          'ALL'
) r ON p.page_key = r.pk;
