import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { DateRange, PeriodRanges } from '../utils/periodUtils'
import { countBusinessDays } from '../utils/businessCalendar'
import { fmtDatetime as fmt, fmtDate } from '../utils/dateHelpers'

import { deptClause, formFilter, CSR_JOIN } from './qcQueryHelpers'

async function scalar(sql: string, params: unknown[]): Promise<number | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params)
  const v = rows[0]?.value
  return v === null || v === undefined ? null : parseFloat(String(v))
}

function safePct(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0) return null
  return (num / den) * 100
}

export interface KpiMeta {
  businessDays: number
  paceTarget: number | null
  startDate: string
  endDate: string
}

export class QCKpiService {
  private async getPaceTarget(kpiCode: string, effectiveDate: Date): Promise<number | null> {
    const dateStr = fmtDate(effectiveDate)
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.goal_value FROM ie_kpi_threshold t
       JOIN ie_kpi k ON t.kpi_id = k.id
       WHERE k.kpi_code = ? AND t.department_key IS NULL
         AND DATE(t.effective_from) <= ?
         AND (t.effective_to IS NULL OR DATE(t.effective_to) >= ?)
       ORDER BY t.effective_from DESC LIMIT 1`,
      [kpiCode, dateStr, dateStr],
    )
    const v = rows[0]?.goal_value
    return v === null || v === undefined ? null : parseFloat(String(v))
  }

  async computeKpisForRange(
    deptFilter: number[],
    range: DateRange,
    userId?: number,
    formNames: string[] = [],
  ): Promise<{ kpis: Record<string, number | null>; meta: KpiMeta }> {
    const s = fmt(range.start)
    const e = fmt(range.end)
    const dc = deptClause(deptFilter)
    const dp = dc.params
    // Form filter is only meaningful for Quality queries (rooted at submissions
    // / disputes). Coaching, quiz, and discipline tables have no form_id link
    // so the form filter is intentionally NOT applied to them — same reason
    // the QC Coaching / Warnings pages don't expose a Form filter at all.
    const ff = formFilter(formNames, 's')
    const fp = ff.params
    const userSql = userId ? 'AND csr.id = ?' : ''
    const userParams = userId ? [userId] : []

    const [businessDays, paceTarget] = await Promise.all([
      countBusinessDays(range.start, range.end),
      this.getPaceTarget('audits_assigned', range.end),
    ])

    // ── Quality ───────────────────────────────────────────────────────────────
    const [avgQa, auditsCompleted, dispCount, finalized,
      upheld, resolved, adjusted, avgResTime, timeToAudit,
      criticalMissedCount, avgCriticalsPerAudit] = await Promise.all([
      scalar(
        `SELECT AVG(COALESCE(s.total_score, ss.score)) AS value
         FROM submissions s
         LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where} ${userSql}`,
        [s, e, ...dp, ...fp, ...userParams],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT COUNT(DISTINCT d.id) AS value FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE d.created_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE d.status IN ('UPHELD','REJECTED') AND d.created_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE d.status IN ('UPHELD','REJECTED','ADJUSTED') AND d.created_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE d.status = 'ADJUSTED' AND d.created_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(d.resolved_at, d.created_at)) AS value FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE d.resolved_at IS NOT NULL AND d.created_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(s.submitted_at, sm_int.date_value)) AS value
         FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         JOIN submission_metadata sm_int ON sm_int.submission_id = s.id
         JOIN form_metadata_fields fmf_int ON sm_int.field_id = fmf_int.id AND fmf_int.field_name = 'Interaction Date'
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ?
           AND sm_int.date_value IS NOT NULL ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      // critical_fail_rate: % of finalized audits where ANY critical question
      // was answered NO. Whether the score cap actually fired (i.e. clipped a
      // raw_score above critical_cap_percent) is a separate question — what we
      // surface here is "are agents missing critical sections at all?".
      scalar(
        `SELECT SUM(CASE WHEN s.critical_fail_count > 0 THEN 1 ELSE 0 END) AS value
         FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
      // avg_criticals_per_audit: total critical NO answers divided by total
      // finalized audits in the period. Mathematically equivalent to
      // AVG(critical_fail_count) but written as SUM/COUNT to make the intent
      // explicit (a value of 2.1 means agents miss ~2 critical questions per
      // audit on average).
      scalar(
        `SELECT SUM(s.critical_fail_count) / NULLIF(COUNT(*), 0) AS value
         FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where}`,
        [s, e, ...dp, ...fp],
      ),
    ])

    // ── Coaching ──────────────────────────────────────────────────────────────
    // session_date = the date the session was held (reliable anchor for all filters)
    const [sessCompleted, sessClosed, sessScheduled, sessTotal, sessDelivered, avgDaysClose,
      followupDue, followupOnTime, timeToCoach] = await Promise.all([
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.status = 'COMPLETED'
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.status = 'CLOSED'
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.status = 'SCHEDULED'
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.delivered_at IS NOT NULL
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(cs.completed_at, cs.created_at)) AS value
         FROM coaching_sessions cs JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.status IN ('COMPLETED','CLOSED')
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.follow_up_required = 1
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.follow_up_required = 1
           AND cs.completed_at IS NOT NULL
           AND cs.follow_up_date IS NOT NULL
           AND cs.completed_at <= cs.follow_up_date
           AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(DATEDIFF(cs.created_at, sub.submitted_at)) AS value
         FROM coaching_sessions cs
         JOIN submissions sub ON cs.qa_audit_id = sub.id
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.source_type = 'QA_AUDIT' AND cs.session_date BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
    ])

    // ── Quiz ──────────────────────────────────────────────────────────────────
    const [quizTotal, quizPassed, avgQuizScore, avgAttempts] = await Promise.all([
      scalar(
        `SELECT COUNT(*) AS value FROM quiz_attempts qa
         JOIN users csr ON qa.user_id = csr.id
         WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT COUNT(*) AS value FROM quiz_attempts qa
         JOIN users csr ON qa.user_id = csr.id
         WHERE qa.passed = 1 AND qa.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(qa.score) AS value FROM quiz_attempts qa
         JOIN users csr ON qa.user_id = csr.id
         WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql}`,
        [s, e, ...dp],
      ),
      scalar(
        `SELECT AVG(t.min_att) AS value FROM (
           SELECT qa.quiz_id, qa.user_id, MIN(qa.attempt_number) AS min_att
           FROM quiz_attempts qa
           JOIN users csr ON qa.user_id = csr.id
           WHERE qa.passed = 1 AND qa.submitted_at BETWEEN ? AND ? ${dc.sql}
           GROUP BY qa.quiz_id, qa.user_id) t`,
        [s, e, ...dp],
      ),
    ])

    // ── Discipline ────────────────────────────────────────────────────────────
    // escalation_rate: write-ups in the period that escalated the agent to a
    //   higher tier (vs their most recent tier in the trailing 12mo) divided
    //   by total write-ups in the period. Mirrors the Step-Up cards on the
    //   Warnings page so the rate and the visualization always agree.
    // repeat_offender_rate: distinct agents with >=2 write-ups whose
    //   created_at falls inside the selected period, divided by distinct
    //   agents written up in the period. Mirrors the Repeat Warning Agents
    //   table on the Warnings page.
    const [wuCount, activeUsers, wuStepUps, wuRepeatAgents, wuWithWu, wuTotal, wuClosed] =
      await Promise.all([
        scalar(
          `SELECT COUNT(*) AS value FROM write_ups wu
           JOIN users csr ON wu.csr_id = csr.id
           WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}`,
          [s, e, ...dp],
        ),
        scalar(`SELECT COUNT(*) AS value FROM users WHERE role_id = 3 AND is_active = 1`, []),
        scalar(
          `SELECT SUM(CASE
                        WHEN (curr.document_type = 'WRITTEN_WARNING' AND curr.prev_tier = 'VERBAL_WARNING')
                          OR (curr.document_type = 'FINAL_WARNING'   AND curr.prev_tier IN ('VERBAL_WARNING','WRITTEN_WARNING'))
                        THEN 1 ELSE 0 END) AS value
           FROM (
             SELECT wu.document_type,
               (SELECT prev.document_type FROM write_ups prev
                  WHERE prev.csr_id = wu.csr_id
                    AND prev.created_at < wu.created_at
                    AND prev.created_at >= DATE_SUB(wu.created_at, INTERVAL 12 MONTH)
                  ORDER BY prev.created_at DESC LIMIT 1) AS prev_tier
             FROM write_ups wu
             JOIN users csr ON wu.csr_id = csr.id
             WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
           ) curr`,
          [s, e, ...dp],
        ),
        scalar(
          `SELECT COUNT(*) AS value FROM (
             SELECT wu.csr_id FROM write_ups wu
             JOIN users csr ON wu.csr_id = csr.id
             WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
             GROUP BY wu.csr_id HAVING COUNT(*) >= 2
           ) repeat_agents`,
          [s, e, ...dp],
        ),
        scalar(
          `SELECT COUNT(DISTINCT wu.csr_id) AS value FROM write_ups wu
           JOIN users csr ON wu.csr_id = csr.id
           WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}`,
          [s, e, ...dp],
        ),
        scalar(
          `SELECT COUNT(*) AS value FROM write_ups wu
           JOIN users csr ON wu.csr_id = csr.id
           WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}`,
          [s, e, ...dp],
        ),
        scalar(
          `SELECT COUNT(*) AS value FROM write_ups wu
           JOIN users csr ON wu.csr_id = csr.id
           WHERE wu.status = 'CLOSED' AND wu.created_at BETWEEN ? AND ? ${dc.sql}`,
          [s, e, ...dp],
        ),
      ])

    const auditsAssigned = paceTarget !== null ? Math.round(paceTarget * businessDays) : null
    const auditCompletionRate = safePct(auditsCompleted, auditsAssigned)

    const coachingCompletionRate = safePct(sessCompleted, sessTotal)

    return {
      kpis: {
      avg_qa_score:                   avgQa,
      audits_assigned:                auditsAssigned,
      audits_completed:               auditsCompleted,
      audit_completion_rate:          auditCompletionRate,
      dispute_rate:                   safePct(dispCount, finalized),
      dispute_upheld_rate:            safePct(upheld, resolved),
      dispute_not_upheld_rate:        null,
      dispute_adjusted_rate:          safePct(adjusted, resolved),
      avg_dispute_resolution_time:    avgResTime,
      critical_fail_rate:             safePct(criticalMissedCount, finalized),
      avg_criticals_per_audit:        avgCriticalsPerAudit,
      time_to_audit:                  timeToAudit,
      qa_score_trend:                 null,
      coaching_sessions_assigned:     sessTotal,
      coaching_sessions_scheduled:    sessScheduled,
      coaching_sessions_completed:    sessCompleted,
      coaching_sessions_closed:       sessClosed,
      coaching_completion_rate:       coachingCompletionRate,
      coaching_delivery_rate:         safePct(sessDelivered, sessTotal),
      avg_days_to_close_coaching:     avgDaysClose,
      followup_compliance_rate:       safePct(followupOnTime, followupDue),
      time_to_coaching:               timeToCoach,
      quizzes_assigned:               quizTotal,
      quizzes_passed:                 quizPassed,
      quiz_pass_rate:                 safePct(quizPassed, quizTotal),
      avg_quiz_score:                 avgQuizScore,
      avg_attempts_to_pass:           avgAttempts,
      total_writeups_issued:          wuCount,
      writeup_rate:                   safePct(wuCount, activeUsers),
      escalation_rate:                safePct(wuStepUps, wuTotal),
      repeat_offender_rate:           safePct(wuRepeatAgents, wuWithWu),
      writeup_resolution_rate:        safePct(wuClosed, wuTotal),
      },
      meta: { businessDays, paceTarget, startDate: s.split(' ')[0], endDate: e.split(' ')[0] },
    }
  }

  async getKpiValues(
    deptFilter: number[],
    ranges: PeriodRanges,
    formNames: string[] = [],
  ): Promise<{ current: Record<string, number | null>; prior: Record<string, number | null>; meta: KpiMeta; priorMeta: KpiMeta }> {
    const [currentResult, priorResult] = await Promise.all([
      this.computeKpisForRange(deptFilter, ranges.current, undefined, formNames),
      this.computeKpisForRange(deptFilter, ranges.prior,   undefined, formNames),
    ])
    const current = currentResult.kpis
    const prior   = priorResult.kpis
    if (current.avg_qa_score !== null && prior.avg_qa_score !== null) {
      current.qa_score_trend = current.avg_qa_score - prior.avg_qa_score
    }
    return { current, prior, meta: currentResult.meta, priorMeta: priorResult.meta }
  }

  async getTrends(
    deptFilter: number[],
    kpiCodes: string[],
    endDate: Date,
    userId?: number,
    formNames: string[] = [],
  ): Promise<Array<Record<string, number | string | null>>> {
    let anchor = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
    for (let probe = 0; probe < 3; probe++) {
      const mStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const mEnd   = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999)
      const { kpis } = await this.computeKpisForRange(deptFilter, { start: mStart, end: mEnd }, userId, formNames)
      const hasData = kpiCodes.some(c => kpis[c] !== null)
      if (hasData) break
      anchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
    }

    const results: Array<Record<string, number | string | null>> = []
    for (let i = 5; i >= 0; i--) {
      const start = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
      const end   = new Date(anchor.getFullYear(), anchor.getMonth() - i + 1, 0, 23, 59, 59, 999)
      const { kpis } = await this.computeKpisForRange(deptFilter, { start, end }, userId, formNames)
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
