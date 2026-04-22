export type KpiFormat    = 'PERCENT' | 'NUMBER'
export type KpiDirection = 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL'

/**
 * How a KPI responds to dashboard filters.
 *  - 'department'   honors the active Department filter (default)
 *  - 'user'         honors the active User filter
 *  - 'non_filtered' ignores all filters; calculated org-wide
 *  - 'mixed'        some inputs honor filters, some don't (e.g. ratio with a global denominator)
 *
 * When `scope` is omitted the KPI is treated as 'department'.
 */
export type KpiScope = 'department' | 'user' | 'non_filtered' | 'mixed'

export interface KpiDef {
  code:      string
  name:      string
  format:    KpiFormat
  direction: KpiDirection
  goal?:     number
  warn?:     number
  crit?:     number
  /** How this KPI responds to dashboard filters. Defaults to 'department'. */
  scope?:        KpiScope
  /** Curated plain-language description (overrides the DB `description` text). */
  description?:  string
  /** Plain-English formula (overrides the DB `formula` text). */
  formulaPlain?: string
  /** Source tables/columns (overrides the DB `source_table` text). */
  source?:       string
}

export const KPI_DEFS: Record<string, KpiDef> = {
  // ── Quality (12) ──────────────────────────────────────────────────────────
  avg_qa_score: {
    code: 'avg_qa_score', name: 'Avg QA Score',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 90, warn: 80, crit: 70,
    scope: 'department',
    description:  'Average total score across finalized audits submitted in the period. Only audits that have a CSR assigned via form metadata are included.',
    formulaPlain: "AVG( COALESCE(submissions.total_score, score_snapshots.score) ) WHERE status = 'FINALIZED' AND submitted_at IN range",
    source:       'submissions, score_snapshots, submission_metadata (CSR field)',
  },
  audits_assigned: {
    code: 'audits_assigned', name: 'Audits Assigned',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'non_filtered',
    description:  'Expected number of audits in the selected period. Calculated as the global pace target (audits per business day, set in Thresholds) multiplied by the number of business days in the period.',
    formulaPlain: 'goal_value (Per Business Day) × business_days_in_period (rounded)',
    source:       'ie_kpi_threshold, business_calendar_days',
  },
  audits_completed: {
    code: 'audits_completed', name: 'Audits Completed',
    format: 'NUMBER', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Count of audits with status FINALIZED submitted in the period. Only audits that have a CSR assigned via form metadata are counted.',
    formulaPlain: "COUNT(submissions) WHERE status = 'FINALIZED' AND submitted_at IN range",
    source:       'submissions, submission_metadata (CSR field)',
  },
  audit_completion_rate: {
    code: 'audit_completion_rate', name: 'Audit Completion %',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 95, warn: 85, crit: 75,
    scope: 'mixed',
    description:  'Percentage of expected audits that were completed. The numerator (completed) honors the Department filter; the denominator (assigned) is calculated org-wide.',
    formulaPlain: 'audits_completed / audits_assigned × 100',
    source:       'submissions, ie_kpi_threshold, business_calendar_days',
  },
  dispute_rate: {
    code: 'dispute_rate', name: 'Dispute Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 5, warn: 10, crit: 20,
    scope: 'department',
    description:  'Disputes created in the period as a percentage of audits finalized in the period. The numerator counts by dispute creation date; the denominator counts by audit submission date — so a dispute can fall in this period for an audit that does not.',
    formulaPlain: 'COUNT(DISTINCT disputes WHERE created_at IN range) / COUNT(submissions WHERE status = \'FINALIZED\' AND submitted_at IN range) × 100',
    source:       'disputes, submissions, submission_metadata (CSR field)',
  },
  dispute_upheld_rate: {
    code: 'dispute_upheld_rate', name: 'Dispute Upheld Rate',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Of disputes created in the period that have an outcome (UPHELD, REJECTED, or ADJUSTED), the share where the original score was kept (UPHELD or REJECTED). A high rate means the auditor\u2019s original scoring was upheld \u2014 higher is better.',
    formulaPlain: "COUNT(disputes WHERE status IN ('UPHELD','REJECTED') AND created_at IN range) / COUNT(disputes WHERE status IN ('UPHELD','REJECTED','ADJUSTED') AND created_at IN range) × 100",
    source:       'disputes, submissions, submission_metadata (CSR field)',
  },
  dispute_not_upheld_rate: {
    code: 'dispute_not_upheld_rate', name: 'Dispute Rejected Rate',
    format: 'PERCENT', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Percentage of resolved disputes that were rejected. Currently returns no value — use Upheld vs Adjusted instead.',
    formulaPlain: 'Not implemented in the calculation engine.',
    source:       'disputes',
  },
  dispute_adjusted_rate: {
    code: 'dispute_adjusted_rate', name: 'Dispute Adjusted Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 30, warn: 40, crit: 50,
    scope: 'department',
    description:  'Of disputes created in the period that have an outcome (UPHELD, REJECTED, or ADJUSTED), the share where the score was changed (ADJUSTED).',
    formulaPlain: "COUNT(disputes WHERE status = 'ADJUSTED' AND created_at IN range) / COUNT(disputes WHERE status IN ('UPHELD','REJECTED','ADJUSTED') AND created_at IN range) × 100",
    source:       'disputes, submissions, submission_metadata (CSR field)',
  },
  avg_dispute_resolution_time: {
    code: 'avg_dispute_resolution_time', name: 'Avg Resolution Time',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 3, warn: 7, crit: 14,
    scope: 'department',
    description:  'Average days between dispute creation and resolution. Filtered by dispute creation date — only disputes created in the period that already have a resolved_at are included.',
    formulaPlain: 'AVG(DATEDIFF(disputes.resolved_at, disputes.created_at)) WHERE resolved_at IS NOT NULL AND created_at IN range',
    source:       'disputes, submissions, submission_metadata (CSR field)',
  },
  critical_fail_rate: {
    code: 'critical_fail_rate', name: 'Critical Fail Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 2, warn: 5, crit: 10,
    scope: 'department',
    description:  'Percentage of finalized audits where at least one critical question was missed.',
    formulaPlain: "COUNT(submissions WHERE critical_fail_count > 0) / COUNT(submissions WHERE status = 'FINALIZED') \u00D7 100",
    source:       'submissions',
  },
  avg_criticals_per_audit: {
    code: 'avg_criticals_per_audit', name: 'Avg Criticals per Audit',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 0.1, warn: 0.3, crit: 0.75,
    scope: 'department',
    description:  'Average critical questions missed per finalized audit (counts every NO, so can exceed 1).',
    formulaPlain: "SUM(submissions.critical_fail_count) / COUNT(submissions WHERE status = 'FINALIZED')",
    source:       'submissions',
  },
  time_to_audit: {
    code: 'time_to_audit', name: 'Time to Audit',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 3, warn: 7, crit: 14,
    scope: 'department',
    description:  'Average days between the interaction date (captured as form metadata, field "Interaction Date") and when the audit was finalized. Audits without an Interaction Date metadata value are excluded.',
    formulaPlain: "AVG(DATEDIFF(submissions.submitted_at, submission_metadata.date_value)) WHERE field_name = 'Interaction Date' AND submissions.status = 'FINALIZED' AND submitted_at IN range",
    source:       'submissions, submission_metadata, form_metadata_fields, submission_metadata (CSR field)',
  },
  qa_score_trend: {
    code: 'qa_score_trend', name: 'QA Score Trend',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Change in Avg QA Score versus the prior period (current minus prior). Positive means scores improved.',
    formulaPlain: 'avg_qa_score(current period) − avg_qa_score(prior period)',
    source:       'submissions, score_snapshots, submission_metadata (CSR field)',
  },
  category_performance: {
    code: 'category_performance', name: 'Category Performance',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Average score per scoring category, calculated from the actual question answers (YES/NO, SCALE, RADIO) on every finalized audit in the period. Sorted by lowest score first so the weakest categories surface; defaults to the bottom 5. Trend compares against the prior period; vs Goal compares against the QA score goal.',
    formulaPlain: 'AVG(question score) per category, computed across finalized submissions in range; vs prior period and vs avg_qa_score goal',
    source:       'submission_answers, form_questions, form_question_categories',
  },
  score_distribution: {
    code: 'score_distribution', name: 'Score Distribution',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Finalized audits in the period bucketed by total score (90–100, 80–89, 70–79, 60–69, Below 60). Each row shows the audit count and its share of the total. Bars at or above the QA score goal are highlighted; bars below the goal are gray. Score uses COALESCE(submissions.total_score, score_snapshots.score). Only audits with a CSR assigned via form metadata are included. Honors the active Department and Form filters.',
    formulaPlain: 'COUNT(submissions) bucketed by COALESCE(total_score, score_snapshot.score) over finalized audits in range',
    source:       'submissions, score_snapshots, submission_metadata',
  },
  avg_score_by_form: {
    code: 'avg_score_by_form', name: 'Average Score by Form',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  "Per-form submission count and average total score for the period. vs Goal compares each form's average against the QA score goal. Click a row to drill in by adding/removing that form from the Form filter. Honors the active Department filter.",
    formulaPlain: 'AVG(total_score) and COUNT(submissions) GROUP BY form_id over finalized audits in range',
    source:       'submissions, forms',
  },
  top_missed_questions: {
    code: 'top_missed_questions', name: 'Top Missed Questions',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD',
    scope: 'department',
    description:  "Up to 10 scoring questions (YES/NO, SCALE, RADIO) with the highest miss rate in the period. A question is 'missed' when it was scoreable but the answer earned 0 points. Only questions answered on at least 5 audits are shown. Expand a row to see the agents who missed it most. Honors the active Department and Form filters.",
    formulaPlain: 'COUNT(answers WHERE points = 0) / COUNT(answers) per question_id, ranked DESC, limited to top 10 with at least 5 answers',
    source:       'submission_answers, form_questions',
  },
  dept_comparison: {
    code: 'dept_comparison', name: 'Department Comparison',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  "Per-department audit count, average QA score, and dispute count for the selected period. Status compares each department's average against the QA score goal. Click a row to focus filters on that department.",
    formulaPlain: 'AVG(total_score), COUNT(submissions), COUNT(disputes) GROUP BY department_id over finalized audits in range',
    source:       'submissions, departments, disputes, submission_metadata',
  },
  // ── Coaching (10) ─────────────────────────────────────────────────────────
  coaching_sessions_assigned: {
    code: 'coaching_sessions_assigned', name: 'Sessions Assigned',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Total coaching sessions in the period (any status). Acts as the denominator for completion, delivery, and cadence.',
    formulaPlain: 'COUNT(coaching_sessions WHERE session_date IN range)',
    source:       'coaching_sessions',
  },
  coaching_sessions_scheduled: {
    code: 'coaching_sessions_scheduled', name: 'Sessions Scheduled',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Coaching sessions still in SCHEDULED status with a session date in the period.',
    formulaPlain: "COUNT(coaching_sessions WHERE status = 'SCHEDULED' AND session_date IN range)",
    source:       'coaching_sessions',
  },
  coaching_sessions_completed: {
    code: 'coaching_sessions_completed', name: 'Sessions Completed',
    format: 'NUMBER', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Coaching sessions in COMPLETED status with a session date in the period.',
    formulaPlain: "COUNT(coaching_sessions WHERE status = 'COMPLETED' AND session_date IN range)",
    source:       'coaching_sessions',
  },
  coaching_sessions_closed: {
    code: 'coaching_sessions_closed', name: 'Sessions Closed',
    format: 'NUMBER', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Coaching sessions in CLOSED status with a session date in the period (final closeout).',
    formulaPlain: "COUNT(coaching_sessions WHERE status = 'CLOSED' AND session_date IN range)",
    source:       'coaching_sessions',
  },
  coaching_completion_rate: {
    code: 'coaching_completion_rate', name: 'Coaching Completion %',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 92, warn: 80, crit: 65,
    scope: 'department',
    description:  'Share of coaching sessions in the period that reached COMPLETED status.',
    formulaPlain: 'coaching_sessions_completed / coaching_sessions_assigned × 100',
    source:       'coaching_sessions',
  },
  coaching_delivery_rate: {
    code: 'coaching_delivery_rate', name: 'Coaching Delivery',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 95, warn: 85, crit: 70,
    scope: 'department',
    description:  'Share of coaching sessions in the period that were actually delivered (delivered_at is set).',
    formulaPlain: 'COUNT(sessions WHERE delivered_at IS NOT NULL) / coaching_sessions_assigned × 100',
    source:       'coaching_sessions',
  },
  avg_days_to_close_coaching: {
    code: 'avg_days_to_close_coaching', name: 'Avg Days to Close',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 10, warn: 21, crit: 30,
    scope: 'department',
    description:  'Average days between when a coaching session is created and when it is completed or closed.',
    formulaPlain: "AVG(DATEDIFF(completed_at, created_at)) WHERE status IN ('COMPLETED','CLOSED') AND session_date IN range",
    source:       'coaching_sessions',
  },
  followup_compliance_rate: {
    code: 'followup_compliance_rate', name: 'Follow-Up Compliance',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 90, warn: 75, crit: 60,
    scope: 'department',
    description:  'Of coaching sessions that required a follow-up, the share completed on or before the follow-up date.',
    formulaPlain: 'COUNT(sessions follow_up_required AND completed_at ≤ follow_up_date) / COUNT(sessions follow_up_required) × 100',
    source:       'coaching_sessions',
  },
  time_to_coaching: {
    code: 'time_to_coaching', name: 'Time to Coaching',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 5, warn: 10, crit: 21,
    scope: 'department',
    description:  'Average days from when an audit was submitted to when its coaching session was created (audit-sourced sessions only).',
    formulaPlain: "AVG(DATEDIFF(coaching.created_at, submission.submitted_at)) WHERE source_type = 'QA_AUDIT' AND session_date IN range",
    source:       'coaching_sessions, submissions',
  },
  coaching_status_distribution: {
    code: 'coaching_status_distribution', name: 'Coaching Sessions by Status',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Coaching sessions in the period grouped by status (Scheduled, In Process, Awaiting CSR Action, Quiz Pending, Completed, Follow-Up Required, Closed). Each row shows the session count, the number of unique agents involved, and a bar relative to the largest status bucket. Expand a row to see the agents and their topics.',
    formulaPlain: 'COUNT(coaching_sessions) GROUP BY status; per-row UNIQUE agents and topics over sessions in range',
    source:       'coaching_sessions, users, departments',
  },
  coaching_repeat_offenders: {
    code: 'coaching_repeat_offenders', name: 'Repeat Coaching',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD',
    scope: 'department',
    description:  'Agents who received more than one coaching session in the period. Shows the agent, department, total sessions, and a sparkline of session activity. Expand a row to see the individual sessions, topics, and statuses. Sorted by session count descending.',
    formulaPlain: 'COUNT(coaching_sessions) GROUP BY user_id HAVING COUNT(*) > 1, ranked DESC over sessions in range',
    source:       'coaching_sessions, users, departments',
  },
  coaching_top_topics: {
    code: 'coaching_top_topics', name: 'Most Coached Topics',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Coaching topics that came up most often during the period, ranked by session count. Defaults to the top 5; click to expand to see which agents were coached on that topic. Drill into an agent profile by clicking their name.',
    formulaPlain: 'COUNT(coaching_session_topics) GROUP BY topic, ranked DESC over sessions in range',
    source:       'coaching_sessions, coaching_session_topics',
  },
  coaching_quiz_performance: {
    code: 'coaching_quiz_performance', name: 'Quiz Performance',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Roll-up of quiz activity tied to coaching: total quizzes assigned, passed, pass rate, average score, and average attempts to pass. The breakdown table lists each quiz with attempts, passes, and miss rate; sorted by misses desc. Expand a row for the agents who failed it most.',
    formulaPlain: 'AGGREGATE(quiz_attempts) per quiz over period; tile values mirror quizzes_assigned, quizzes_passed, quiz_pass_rate, avg_quiz_score, avg_attempts_to_pass',
    source:       'quiz_attempts, quizzes, users',
  },
  coaching_dept_comparison: {
    code: 'coaching_dept_comparison', name: 'Department Coaching Comparison',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  "Per-department coaching activity for the period: total sessions, completed, completion %, and average days to close. Status compares each department's completion against the coaching_completion_rate goal. Click a row to focus filters on that department.",
    formulaPlain: 'COUNT(sessions), COUNT(completed), AVG(DATEDIFF(completed_at, created_at)) GROUP BY department_id over sessions in range',
    source:       'coaching_sessions, departments, users',
  },
  // ── Quiz (5) ──────────────────────────────────────────────────────────────
  quizzes_assigned: {
    code: 'quizzes_assigned', name: 'Quizzes Assigned',
    format: 'NUMBER', direction: 'NEUTRAL',
    scope: 'department',
    description:  'Total quiz attempts submitted in the period (each attempt counts once). Used as the denominator for Quiz Pass Rate.',
    formulaPlain: 'COUNT(quiz_attempts WHERE submitted_at IN range)',
    source:       'quiz_attempts',
  },
  quizzes_passed: {
    code: 'quizzes_passed', name: 'Quizzes Passed',
    format: 'NUMBER', direction: 'UP_IS_GOOD',
    scope: 'department',
    description:  'Quiz attempts that passed (passed flag = true) submitted in the period.',
    formulaPlain: 'COUNT(quiz_attempts WHERE passed = 1 AND submitted_at IN range)',
    source:       'quiz_attempts',
  },
  quiz_pass_rate: {
    code: 'quiz_pass_rate', name: 'Quiz Pass Rate',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 85, warn: 70, crit: 55,
    scope: 'department',
    description:  'Share of quiz attempts in the period that were passed.',
    formulaPlain: 'quizzes_passed / quizzes_assigned × 100',
    source:       'quiz_attempts',
  },
  avg_quiz_score: {
    code: 'avg_quiz_score', name: 'Avg Quiz Score',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 82, warn: 70, crit: 60,
    scope: 'department',
    description:  'Average score across all quiz attempts submitted in the period.',
    formulaPlain: 'AVG(quiz_attempts.score) WHERE submitted_at IN range',
    source:       'quiz_attempts',
  },
  avg_attempts_to_pass: {
    code: 'avg_attempts_to_pass', name: 'Avg Attempts to Pass',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 1.2, warn: 1.8, crit: 2.5,
    scope: 'department',
    description:  'For users who eventually passed a quiz in the period, the average attempt number on which they first passed.',
    formulaPlain: 'AVG( MIN(attempt_number) per (user, quiz) WHERE passed = 1 AND submitted_at IN range )',
    source:       'quiz_attempts',
  },
  // ── Discipline (5) ────────────────────────────────────────────────────────
  total_writeups_issued: {
    code: 'total_writeups_issued', name: 'Warnings Issued',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD',
    scope: 'department',
    description:  'Count of write-ups created in the period.',
    formulaPlain: 'COUNT(write_ups WHERE created_at IN range)',
    source:       'write_ups',
  },
  writeup_rate: {
    code: 'writeup_rate', name: 'Warning Rate',
    format: 'PERCENT', direction: 'NEUTRAL',
    scope: 'mixed',
    description:  'Write-ups in the period as a percentage of active agents. The numerator (write-ups) honors the Department filter; the denominator (active agents) is calculated org-wide.',
    formulaPlain: 'total_writeups_issued / COUNT(active agents, org-wide) × 100',
    source:       'write_ups, users',
  },
  escalation_rate: {
    code: 'escalation_rate', name: 'Escalation Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 15, warn: 25, crit: 40,
    scope: 'department',
    description:  'Share of write-ups in the period that referenced prior discipline (i.e. were escalations of an earlier warning).',
    formulaPlain: 'COUNT(distinct write_ups in range that have prior_discipline rows) / total_writeups_issued × 100',
    source:       'write_ups, write_up_prior_discipline',
  },
  repeat_offender_rate: {
    code: 'repeat_offender_rate', name: 'Repeat Offender Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 10, warn: 20, crit: 35,
    scope: 'department',
    description:  'Of agents written up in the period, the share who had two or more write-ups within a rolling 90-day window.',
    formulaPlain: 'COUNT(distinct agents with ≥2 write-ups in any 90-day window in range) / COUNT(distinct agents written up in range) × 100',
    source:       'write_ups',
  },
  writeup_resolution_rate: {
    code: 'writeup_resolution_rate', name: 'Warning Resolution',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 90, warn: 75, crit: 60,
    scope: 'department',
    description:  'Share of write-ups created in the period that have reached CLOSED status.',
    formulaPlain: "COUNT(write_ups WHERE status = 'CLOSED' AND created_at IN range) / total_writeups_issued × 100",
    source:       'write_ups',
  },
}

/** Resolves thresholds for a KPI tile — falls back to the static defaults from kpiDefs */
export function getKpiDef(code: string): KpiDef | undefined {
  return KPI_DEFS[code]
}

/**
 * Returns the effective scope for a KPI ('department' if not explicitly set).
 */
export function getKpiScope(code: string): KpiScope {
  return KPI_DEFS[code]?.scope ?? 'department'
}

/** Format a raw KPI value to display string */
export function formatKpiValue(value: number | null, format: KpiFormat, decimals = 1): string {
  if (value === null || value === undefined) return '—'
  const fixed = value.toFixed(decimals)
  return format === 'PERCENT' ? `${fixed}%` : fixed
}

/** Evaluate threshold status: 'good' | 'warning' | 'critical' | 'neutral' */
export function getThresholdStatus(
  value: number,
  def: Pick<KpiDef, 'direction' | 'goal' | 'warn' | 'crit'>,
): 'good' | 'warning' | 'critical' | 'neutral' {
  const { direction, goal, warn, crit } = def
  if (direction === 'NEUTRAL' || goal === undefined) return 'neutral'

  if (direction === 'UP_IS_GOOD') {
    if (goal !== undefined && value >= goal) return 'good'
    if (warn !== undefined && value >= warn) return 'warning'
    if (crit !== undefined && value <= crit) return 'critical'
    return 'warning'
  }

  // DOWN_IS_GOOD — lower is better
  if (goal !== undefined && value <= goal) return 'good'
  if (warn !== undefined && value <= warn) return 'warning'
  if (crit !== undefined && value >= crit) return 'critical'
  return 'warning'
}
