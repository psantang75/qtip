import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { DateRange, PeriodRanges } from '../utils/periodUtils'

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function deptClause(
  deptFilter: number[],
  alias = 'csr',
): { sql: string; params: number[] } {
  if (deptFilter.length === 0) return { sql: '', params: [] }
  const ph = deptFilter.map(() => '?').join(',')
  return { sql: `AND ${alias}.department_id IN (${ph})`, params: deptFilter }
}

async function scalar(sql: string, params: unknown[]): Promise<number | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params)
  const v = rows[0]?.value
  return v === null || v === undefined ? null : parseFloat(String(v))
}

function safePct(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0) return null
  return (num / den) * 100
}

export class QCKpiService {
  async computeKpisForRange(
    deptFilter: number[],
    range: DateRange,
  ): Promise<Record<string, number | null>> {
    const s = fmt(range.start)
    const e = fmt(range.end)
    const dc = deptClause(deptFilter)
    const dp = dc.params

    // ── Quality ───────────────────────────────────────────────────────────────
    const [avgQa, auditsCompleted, dispCount, finalized,
      upheld, resolved, adjusted, avgResTime, timeToAudit] = await Promise.all([
      scalar(
        `SELECT AVG(s.total_score) AS value FROM submissions s
         LEFT JOIN calls c ON s.call_id = c.id
         LEFT JOIN users csr ON c.csr_id = csr.id
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM submissions s
         LEFT JOIN calls c ON s.call_id = c.id
         LEFT JOIN users csr ON c.csr_id = csr.id
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(DISTINCT d.id) AS value FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         LEFT JOIN calls c ON s.call_id = c.id
         LEFT JOIN users csr ON c.csr_id = csr.id
         WHERE d.created_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM submissions s
         LEFT JOIN calls c ON s.call_id = c.id
         LEFT JOIN users csr ON c.csr_id = csr.id
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM disputes d
         WHERE d.status = 'UPHELD' AND d.resolved_at BETWEEN ? AND ?`,
        [s, e],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM disputes d
         WHERE d.status IN ('UPHELD','REJECTED','ADJUSTED') AND d.resolved_at BETWEEN ? AND ?`,
        [s, e],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM disputes d
         WHERE d.status = 'ADJUSTED' AND d.resolved_at BETWEEN ? AND ?`,
        [s, e],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(d.resolved_at, d.created_at)) AS value FROM disputes d
         WHERE d.resolved_at IS NOT NULL AND d.resolved_at BETWEEN ? AND ?`,
        [s, e],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(s.submitted_at, c.call_date)) AS value
         FROM submissions s JOIN calls c ON s.call_id = c.id
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ?`,
        [s, e],
      ),
    ])

    // ── Coaching ──────────────────────────────────────────────────────────────
    const [sessCompleted, sessTotal, sessDelivered, avgDaysClose,
      followupDue, followupOnTime, timeToCoach] = await Promise.all([
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.status IN ('COMPLETED','CLOSED')
           AND cs.completed_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.created_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.delivered_at IS NOT NULL
           AND cs.created_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(cs.completed_at, cs.created_at)) AS value
         FROM coaching_sessions cs JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.status IN ('COMPLETED','CLOSED')
           AND cs.completed_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.follow_up_required = 1
           AND cs.completed_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.follow_up_required = 1
           AND cs.completed_at IS NOT NULL
           AND cs.follow_up_date IS NOT NULL
           AND cs.completed_at <= cs.follow_up_date
           AND cs.completed_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(cs.created_at, sub.submitted_at)) AS value
         FROM coaching_sessions cs JOIN submissions sub ON cs.qa_audit_id = sub.id
         WHERE cs.source_type = 'QA_AUDIT' AND cs.created_at BETWEEN ? AND ?`,
        [s, e],
      ),
    ])

    // ── Quiz ──────────────────────────────────────────────────────────────────
    const [quizTotal, quizPassed, avgQuizScore, avgAttempts] = await Promise.all([
      scalar(
        `SELECT COUNT(*) AS value FROM quiz_attempts qa
         JOIN users u ON qa.user_id = u.id
         WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM quiz_attempts qa
         JOIN users u ON qa.user_id = u.id
         WHERE qa.passed = 1 AND qa.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(qa.score) AS value FROM quiz_attempts qa
         JOIN users u ON qa.user_id = u.id
         WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(t.min_att) AS value FROM (
           SELECT quiz_id, user_id, MIN(attempt_number) AS min_att
           FROM quiz_attempts WHERE passed = 1 AND submitted_at BETWEEN ? AND ?
           GROUP BY quiz_id, user_id) t`,
        [s, e],
      ),
    ])

    // ── Discipline ────────────────────────────────────────────────────────────
    const [wuCount, activeUsers, wuEscalated, wuTotal, wuRepeatAgents, wuWithWu, wuClosed] =
      await Promise.all([
        scalar(
          `SELECT COUNT(*) AS value FROM write_ups wu
           JOIN users csr ON wu.csr_id = csr.id
           WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}`,
          [s, e, ...dp],
        ),
        scalar(`SELECT COUNT(*) AS value FROM users WHERE role_id = 3 AND is_active = 1`, []),
        scalar(
          `SELECT COUNT(DISTINCT wupd.write_up_id) AS value
           FROM write_up_prior_discipline wupd
           JOIN write_ups wu ON wu.id = wupd.write_up_id
           WHERE wu.created_at BETWEEN ? AND ?`,
          [s, e],
        ),
        scalar(`SELECT COUNT(*) AS value FROM write_ups wu WHERE wu.created_at BETWEEN ? AND ?`, [s, e]),
        scalar(
          `SELECT COUNT(DISTINCT wu1.csr_id) AS value FROM write_ups wu1
           WHERE wu1.created_at BETWEEN ? AND ?
             AND EXISTS (
               SELECT 1 FROM write_ups wu2
               WHERE wu2.csr_id = wu1.csr_id AND wu2.id != wu1.id
                 AND wu2.created_at BETWEEN wu1.created_at
                     AND DATE_ADD(wu1.created_at, INTERVAL 90 DAY))`,
          [s, e],
        ),
        scalar(
          `SELECT COUNT(DISTINCT csr_id) AS value FROM write_ups WHERE created_at BETWEEN ? AND ?`,
          [s, e],
        ),
        scalar(
          `SELECT COUNT(*) AS value FROM write_ups wu
           WHERE wu.status = 'CLOSED' AND wu.created_at BETWEEN ? AND ?`,
          [s, e],
        ),
      ])

    return {
      avg_qa_score:                   avgQa,
      audits_assigned:                null, // pace-based: configured in KPI thresholds
      audits_completed:               auditsCompleted,
      audit_completion_rate:          null, // pace-based
      dispute_rate:                   safePct(dispCount, finalized),
      dispute_upheld_rate:            safePct(upheld, resolved),
      dispute_not_upheld_rate:        resolved && resolved > 0
        ? ((resolved - (upheld ?? 0) - (adjusted ?? 0)) / resolved) * 100 : null,
      dispute_adjusted_rate:          safePct(adjusted, finalized),
      avg_dispute_resolution_time:    avgResTime,
      critical_fail_rate:             null, // requires auto_fail schema column
      time_to_audit:                  timeToAudit,
      qa_score_trend:                 null, // set externally by comparing to prior
      coaching_sessions_assigned:     null, // pace-based
      coaching_sessions_completed:    sessCompleted,
      coaching_completion_rate:       null, // pace-based
      coaching_delivery_rate:         safePct(sessDelivered, sessTotal),
      coaching_cadence:               null, // pace-based
      avg_days_to_close_coaching:     avgDaysClose,
      followup_compliance_rate:       safePct(followupOnTime, followupDue),
      time_to_coaching:               timeToCoach,
      quiz_pass_rate:                 safePct(quizPassed, quizTotal),
      avg_quiz_score:                 avgQuizScore,
      avg_attempts_to_pass:           avgAttempts,
      total_writeups_issued:          wuCount,
      writeup_rate:                   safePct(wuCount, activeUsers),
      escalation_rate:                safePct(wuEscalated, wuTotal),
      repeat_offender_rate:           safePct(wuRepeatAgents, wuWithWu),
      writeup_resolution_rate:        safePct(wuClosed, wuTotal),
    }
  }

  async getKpiValues(
    deptFilter: number[],
    ranges: PeriodRanges,
  ): Promise<{ current: Record<string, number | null>; prior: Record<string, number | null> }> {
    const [current, prior] = await Promise.all([
      this.computeKpisForRange(deptFilter, ranges.current),
      this.computeKpisForRange(deptFilter, ranges.prior),
    ])
    if (current.avg_qa_score !== null && prior.avg_qa_score !== null) {
      current.qa_score_trend = current.avg_qa_score - prior.avg_qa_score
    }
    return { current, prior }
  }

  async getTrends(
    deptFilter: number[],
    kpiCodes: string[],
    endDate: Date,
  ): Promise<Array<Record<string, number | string | null>>> {
    const results: Array<Record<string, number | string | null>> = []
    for (let i = 5; i >= 0; i--) {
      const start = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1)
      const end   = new Date(endDate.getFullYear(), endDate.getMonth() - i + 1, 0, 23, 59, 59, 999)
      const kpis  = await this.computeKpisForRange(deptFilter, { start, end })
      const row: Record<string, number | string | null> = {
        label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      }
      for (const code of kpiCodes) row[code] = kpis[code] ?? null
      results.push(row)
    }
    return results
  }
}

export const qcKpiService = new QCKpiService()
