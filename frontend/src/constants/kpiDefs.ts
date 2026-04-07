export type KpiFormat    = 'PERCENT' | 'NUMBER'
export type KpiDirection = 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL'

export interface KpiDef {
  code:      string
  name:      string
  format:    KpiFormat
  direction: KpiDirection
  goal?:     number
  warn?:     number
  crit?:     number
}

export const KPI_DEFS: Record<string, KpiDef> = {
  // ── Quality (12) ──────────────────────────────────────────────────────────
  avg_qa_score: {
    code: 'avg_qa_score', name: 'Avg QA Score',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 90, warn: 80, crit: 70,
  },
  audits_assigned: {
    code: 'audits_assigned', name: 'Audits Assigned',
    format: 'NUMBER', direction: 'NEUTRAL',
  },
  audits_completed: {
    code: 'audits_completed', name: 'Audits Completed',
    format: 'NUMBER', direction: 'UP_IS_GOOD',
  },
  audit_completion_rate: {
    code: 'audit_completion_rate', name: 'Audit Completion %',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 95, warn: 85, crit: 75,
  },
  dispute_rate: {
    code: 'dispute_rate', name: 'Dispute Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 5, warn: 10, crit: 20,
  },
  dispute_upheld_rate: {
    code: 'dispute_upheld_rate', name: 'Dispute Upheld Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 10, warn: 20, crit: 35,
  },
  dispute_not_upheld_rate: {
    code: 'dispute_not_upheld_rate', name: 'Dispute Rejected Rate',
    format: 'PERCENT', direction: 'NEUTRAL',
  },
  dispute_adjusted_rate: {
    code: 'dispute_adjusted_rate', name: 'Dispute Adjusted Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 3, warn: 8, crit: 15,
  },
  avg_dispute_resolution_time: {
    code: 'avg_dispute_resolution_time', name: 'Avg Resolution Time',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 3, warn: 7, crit: 14,
  },
  critical_fail_rate: {
    code: 'critical_fail_rate', name: 'Critical Fail Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 2, warn: 5, crit: 10,
  },
  time_to_audit: {
    code: 'time_to_audit', name: 'Time to Audit',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 3, warn: 7, crit: 14,
  },
  qa_score_trend: {
    code: 'qa_score_trend', name: 'QA Score Trend',
    format: 'PERCENT', direction: 'UP_IS_GOOD',
  },
  // ── Coaching (8) ──────────────────────────────────────────────────────────
  coaching_sessions_assigned: {
    code: 'coaching_sessions_assigned', name: 'Sessions Assigned',
    format: 'NUMBER', direction: 'NEUTRAL',
  },
  coaching_sessions_completed: {
    code: 'coaching_sessions_completed', name: 'Sessions Completed',
    format: 'NUMBER', direction: 'UP_IS_GOOD',
  },
  coaching_completion_rate: {
    code: 'coaching_completion_rate', name: 'Coaching Completion %',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 92, warn: 80, crit: 65,
  },
  coaching_delivery_rate: {
    code: 'coaching_delivery_rate', name: 'Coaching Delivery',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 95, warn: 85, crit: 70,
  },
  coaching_cadence: {
    code: 'coaching_cadence', name: 'Coaching Cadence',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 95, warn: 80, crit: 60,
  },
  avg_days_to_close_coaching: {
    code: 'avg_days_to_close_coaching', name: 'Avg Days to Close',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 10, warn: 21, crit: 30,
  },
  followup_compliance_rate: {
    code: 'followup_compliance_rate', name: 'Follow-Up Compliance',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 90, warn: 75, crit: 60,
  },
  time_to_coaching: {
    code: 'time_to_coaching', name: 'Time to Coaching',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 5, warn: 10, crit: 21,
  },
  // ── Quiz (3) ──────────────────────────────────────────────────────────────
  quiz_pass_rate: {
    code: 'quiz_pass_rate', name: 'Quiz Pass Rate',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 85, warn: 70, crit: 55,
  },
  avg_quiz_score: {
    code: 'avg_quiz_score', name: 'Avg Quiz Score',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 82, warn: 70, crit: 60,
  },
  avg_attempts_to_pass: {
    code: 'avg_attempts_to_pass', name: 'Avg Attempts to Pass',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD', goal: 1.2, warn: 1.8, crit: 2.5,
  },
  // ── Discipline (5) ────────────────────────────────────────────────────────
  total_writeups_issued: {
    code: 'total_writeups_issued', name: 'Write-Ups Issued',
    format: 'NUMBER', direction: 'DOWN_IS_GOOD',
  },
  writeup_rate: {
    code: 'writeup_rate', name: 'Write-Up Rate',
    format: 'NUMBER', direction: 'NEUTRAL',
  },
  escalation_rate: {
    code: 'escalation_rate', name: 'Escalation Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 15, warn: 25, crit: 40,
  },
  repeat_offender_rate: {
    code: 'repeat_offender_rate', name: 'Repeat Offender Rate',
    format: 'PERCENT', direction: 'DOWN_IS_GOOD', goal: 10, warn: 20, crit: 35,
  },
  writeup_resolution_rate: {
    code: 'writeup_resolution_rate', name: 'Write-Up Resolution',
    format: 'PERCENT', direction: 'UP_IS_GOOD', goal: 90, warn: 75, crit: 60,
  },
}

/** Resolves thresholds for a KPI tile — falls back to the static defaults from kpiDefs */
export function getKpiDef(code: string): KpiDef | undefined {
  return KPI_DEFS[code]
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
