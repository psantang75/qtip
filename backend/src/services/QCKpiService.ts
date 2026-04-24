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

/** Run a query that returns a single row of named numeric aggregates. */
async function aggregateRow(sql: string, params: unknown[]): Promise<Record<string, number | null>> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params)
  const row = rows[0] ?? {}
  const out: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = v === null || v === undefined ? null : parseFloat(String(v))
  }
  return out
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

    // Each block below is a single grouped aggregate that replaces what used
    // to be N individual scalar() calls hitting the same table with different
    // WHERE filters. The total round-trip count drops from ~32 to ~10 per
    // call, and (combined with Pillar 1 indexes) each query is now an index
    // seek rather than a full scan.
    //
    // Block A — submissions rooted, FINALIZED + date filter, with score_snapshots LEFT JOIN.
    //          Kept separate from Block B because the LEFT JOIN can theoretically inflate
    //          row counts if a submission has multiple snapshot rows; AVG tolerates
    //          duplication (matches original avgQa behavior) but COUNT/SUM does not.
    // Block B — submissions rooted, FINALIZED + date filter, no score_snapshots join.
    //          Yields auditsCompleted (= finalized), criticalMissedCount, avgCriticalsPerAudit.
    // Block C — disputes rooted, dispute date filter. SUM(CASE) gives every dispute slice.
    // Block D — submissions + Interaction Date metadata join (own row count, own query).
    // Block E — coaching_sessions rooted, session_date filter. SUM(CASE) gives every status slice.
    // Block F — coaching_sessions JOIN submissions — own join shape, own query.
    // Block G — quiz_attempts rooted, qa.submitted_at filter. SUM(CASE) gives passed/total/avg.
    // Block H — quiz attempts attempts-to-pass derived table — own GROUP BY, own query.
    // Block I — write_ups rooted, wu.created_at filter. SUM(CASE) gives wuCount/wuClosed/wuWithWu.
    // Block J — active CSR cohort. Trivial standalone count.
    // Block K — write-up step-ups (correlated subquery for prev tier) — own query.
    // Block L — write-up repeat agents (HAVING clause) — own query.
    const qpFinalized: unknown[] = [s, e, ...dp, ...fp, ...userParams]
    const qpDate:      unknown[] = [s, e, ...dp, ...userParams]

    const [qualityA, qualityB, qualityC, qualityD,
      coachingE, timeToCoachF,
      quizG, quizH,
      wuI, activeUsersJ, wuStepUpsK, wuRepeatAgentsL] = await Promise.all([
      // Block A: avgQa (LEFT JOIN score_snapshots for fallback score)
      aggregateRow(
        `SELECT AVG(COALESCE(s.total_score, ss.score)) AS avgQa
         FROM submissions s
         LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where} ${userSql}`,
        qpFinalized,
      ),
      // Block B: auditsCompleted, criticalMissedCount, avgCriticalsPerAudit.
      // critical_fail_rate counts finalized audits where ANY critical question
      // was answered NO; avg_criticals_per_audit is SUM(critical_fail_count) /
      // COUNT(finalized) — a value of 2.1 means agents miss ~2 critical
      // questions per audit on average.
      aggregateRow(
        `SELECT
           COUNT(*) AS auditsCompleted,
           COALESCE(SUM(CASE WHEN s.critical_fail_count > 0 THEN 1 ELSE 0 END), 0) AS criticalMissedCount,
           SUM(s.critical_fail_count) / NULLIF(COUNT(*), 0) AS avgCriticalsPerAudit
         FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where} ${userSql}`,
        qpFinalized,
      ),
      // Block C: dispCount, upheld, resolved, adjusted, avgResTime.
      aggregateRow(
        `SELECT
           COUNT(DISTINCT d.id) AS dispCount,
           COALESCE(SUM(CASE WHEN d.status IN ('UPHELD','REJECTED')           THEN 1 ELSE 0 END), 0) AS upheld,
           COALESCE(SUM(CASE WHEN d.status IN ('UPHELD','REJECTED','ADJUSTED') THEN 1 ELSE 0 END), 0) AS resolved,
           COALESCE(SUM(CASE WHEN d.status = 'ADJUSTED'                        THEN 1 ELSE 0 END), 0) AS adjusted,
           AVG(CASE WHEN d.resolved_at IS NOT NULL THEN DATEDIFF(d.resolved_at, d.created_at) ELSE NULL END) AS avgResTime
         FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         ${CSR_JOIN}
         ${ff.join}
         WHERE d.created_at BETWEEN ? AND ? ${dc.sql} ${ff.where} ${userSql}`,
        qpFinalized,
      ),
      // Block D: timeToAudit (lag from interaction date to QA submission).
      aggregateRow(
        `SELECT AVG(DATEDIFF(s.submitted_at, sm_int.date_value)) AS timeToAudit
         FROM submissions s
         ${CSR_JOIN}
         ${ff.join}
         JOIN submission_metadata sm_int ON sm_int.submission_id = s.id
         JOIN form_metadata_fields fmf_int ON sm_int.field_id = fmf_int.id AND fmf_int.field_name = 'Interaction Date'
         WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ?
           AND sm_int.date_value IS NOT NULL ${dc.sql} ${ff.where} ${userSql}`,
        qpFinalized,
      ),
      // Block E: every coaching session status slice in one pass.
      // session_date = the date the session was held (reliable anchor for all filters).
      aggregateRow(
        `SELECT
           COALESCE(SUM(CASE WHEN cs.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS sessCompleted,
           COALESCE(SUM(CASE WHEN cs.status = 'CLOSED'    THEN 1 ELSE 0 END), 0) AS sessClosed,
           COALESCE(SUM(CASE WHEN cs.status = 'SCHEDULED' THEN 1 ELSE 0 END), 0) AS sessScheduled,
           COUNT(*) AS sessTotal,
           COALESCE(SUM(CASE WHEN cs.delivered_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS sessDelivered,
           AVG(CASE WHEN cs.status IN ('COMPLETED','CLOSED')
                    THEN DATEDIFF(cs.completed_at, cs.created_at) ELSE NULL END) AS avgDaysClose,
           COALESCE(SUM(CASE WHEN cs.follow_up_required = 1 THEN 1 ELSE 0 END), 0) AS followupDue,
           COALESCE(SUM(CASE WHEN cs.follow_up_required = 1
                              AND cs.completed_at IS NOT NULL
                              AND cs.follow_up_date IS NOT NULL
                              AND cs.completed_at <= cs.follow_up_date
                             THEN 1 ELSE 0 END), 0) AS followupOnTime
         FROM coaching_sessions cs
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.session_date BETWEEN ? AND ? ${dc.sql} ${userSql}`,
        qpDate,
      ),
      // Block F: timeToCoach — different join shape (needs submissions for QA-sourced sessions).
      aggregateRow(
        `SELECT AVG(DATEDIFF(cs.created_at, sub.submitted_at)) AS timeToCoach
         FROM coaching_sessions cs
         JOIN submissions sub ON cs.qa_audit_id = sub.id
         JOIN users csr ON cs.csr_id = csr.id
         WHERE cs.source_type = 'QA_AUDIT' AND cs.session_date BETWEEN ? AND ? ${dc.sql} ${userSql}`,
        qpDate,
      ),
      // Block G: quizTotal, quizPassed, avgQuizScore.
      aggregateRow(
        `SELECT
           COUNT(*) AS quizTotal,
           COALESCE(SUM(CASE WHEN qa.passed = 1 THEN 1 ELSE 0 END), 0) AS quizPassed,
           AVG(qa.score) AS avgQuizScore
         FROM quiz_attempts qa
         JOIN users csr ON qa.user_id = csr.id
         WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql} ${userSql}`,
        qpDate,
      ),
      // Block H: avgAttempts — keeps its own derived table because the
      // GROUP BY changes the granularity (per quiz × user) and would corrupt
      // the other aggregates if folded into Block G.
      scalar(
        `SELECT AVG(t.min_att) AS value FROM (
           SELECT qa.quiz_id, qa.user_id, MIN(qa.attempt_number) AS min_att
           FROM quiz_attempts qa
           JOIN users csr ON qa.user_id = csr.id
           WHERE qa.passed = 1 AND qa.submitted_at BETWEEN ? AND ? ${dc.sql} ${userSql}
           GROUP BY qa.quiz_id, qa.user_id) t`,
        qpDate,
      ),
      // Block I: wuCount (= wuTotal in old code), wuClosed, wuWithWu.
      aggregateRow(
        `SELECT
           COUNT(*) AS wuCount,
           COUNT(DISTINCT wu.csr_id) AS wuWithWu,
           COALESCE(SUM(CASE WHEN wu.status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS wuClosed
         FROM write_ups wu
         JOIN users csr ON wu.csr_id = csr.id
         WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} ${userSql}`,
        qpDate,
      ),
      // Block J: activeUsers — trivial standalone count, not date-bounded.
      scalar(`SELECT COUNT(*) AS value FROM users WHERE role_id = 3 AND is_active = 1`, []),
      // Block K: escalation_rate numerator. Write-ups in the period that
      // escalated the agent to a higher tier (vs their most recent tier in
      // the trailing 12mo). Mirrors the Step-Up cards on the Warnings page.
      // Correlated subquery — must stay separate from Block I.
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
           WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} ${userSql}
         ) curr`,
        qpDate,
      ),
      // Block L: repeat_offender_rate numerator — distinct agents with ≥2
      // write-ups whose created_at is in the period. Mirrors the Repeat
      // Warning Agents table. Different grain than Block I (HAVING).
      scalar(
        `SELECT COUNT(*) AS value FROM (
           SELECT wu.csr_id FROM write_ups wu
           JOIN users csr ON wu.csr_id = csr.id
           WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} ${userSql}
           GROUP BY wu.csr_id HAVING COUNT(*) >= 2
         ) repeat_agents`,
        qpDate,
      ),
    ])

    const avgQa                 = qualityA.avgQa
    const auditsCompleted       = qualityB.auditsCompleted
    const criticalMissedCount   = qualityB.criticalMissedCount
    const avgCriticalsPerAudit  = qualityB.avgCriticalsPerAudit
    const finalized             = auditsCompleted // identical query in the old code; keep semantic alias
    const dispCount             = qualityC.dispCount
    const upheld                = qualityC.upheld
    const resolved              = qualityC.resolved
    const adjusted              = qualityC.adjusted
    const avgResTime            = qualityC.avgResTime
    const timeToAudit           = qualityD.timeToAudit
    const sessCompleted         = coachingE.sessCompleted
    const sessClosed            = coachingE.sessClosed
    const sessScheduled         = coachingE.sessScheduled
    const sessTotal             = coachingE.sessTotal
    const sessDelivered         = coachingE.sessDelivered
    const avgDaysClose          = coachingE.avgDaysClose
    const followupDue           = coachingE.followupDue
    const followupOnTime        = coachingE.followupOnTime
    const timeToCoach           = timeToCoachF.timeToCoach
    const quizTotal             = quizG.quizTotal
    const quizPassed            = quizG.quizPassed
    const avgQuizScore          = quizG.avgQuizScore
    const avgAttempts           = quizH
    const wuCount               = wuI.wuCount
    const wuWithWu              = wuI.wuWithWu
    const wuClosed              = wuI.wuClosed
    const wuTotal               = wuCount // identical query in the old code; keep semantic alias
    const activeUsers           = activeUsersJ
    const wuStepUps             = wuStepUpsK
    const wuRepeatAgents        = wuRepeatAgentsL

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
    userId?: number,
  ): Promise<{ current: Record<string, number | null>; prior: Record<string, number | null>; meta: KpiMeta; priorMeta: KpiMeta }> {
    const [currentResult, priorResult] = await Promise.all([
      this.computeKpisForRange(deptFilter, ranges.current, userId, formNames),
      this.computeKpisForRange(deptFilter, ranges.prior,   userId, formNames),
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

    // Each month is independent — parallelize the 6 month-ranges instead of
    // running them sequentially. Wall-clock drops ~6× for the trends endpoint
    // with no behavior change.
    const monthRanges = Array.from({ length: 6 }, (_, idx) => {
      const i = 5 - idx
      const start = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
      const end   = new Date(anchor.getFullYear(), anchor.getMonth() - i + 1, 0, 23, 59, 59, 999)
      return { start, end }
    })

    const monthResults = await Promise.all(
      monthRanges.map(r => this.computeKpisForRange(deptFilter, r, userId, formNames)),
    )

    return monthRanges.map(({ start }, idx) => {
      const { kpis } = monthResults[idx]
      const row: Record<string, number | string | null> = {
        label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      }
      for (const code of kpiCodes) row[code] = kpis[code] ?? null
      return row
    })
  }
}

export const qcKpiService = new QCKpiService()
