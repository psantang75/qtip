import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'
import { fmtDatetime as fmt } from '../utils/dateHelpers'
import { deptClause } from './qcQueryHelpers'

export interface AgentSummary {
  userId: number; name: string; dept: string
  qa: number | null; trend: string
  coaching: number; quiz: number; disputes: number; writeups: number
  risk: boolean; cadence: number; expected: number
}
export interface AgentProfile {
  user: { id: number; name: string; dept: string; title: string | null }
  recentAudits: Array<{ id: number; form: string; score: number | null; date: string; status: string }>
  coachingSessions: Array<{ id: number; date: string; purpose: string; format: string; status: string; topics: string[] }>
  quizzes: Array<{ id: number; quiz: string; score: number; passed: boolean; date: string; attempts: number }>
  writeUps: Array<{ id: number; type: string; status: string; date: string }>
}

export class QCAnalyticsService {
  async getAgents(deptFilter: number[], ranges: PeriodRanges): Promise<AgentSummary[]> {
    const s  = fmt(ranges.current.start)
    const e  = fmt(ranges.current.end)
    const ps = fmt(ranges.prior.start)
    const pe = fmt(ranges.prior.end)
    const dc = deptClause(deptFilter)
    const dp = dc.params

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id AS userId, u.username AS name,
         COALESCE(d.department_name, 'Unknown') AS dept,
         AVG(COALESCE(sub.total_score, ss.score)) AS qa,
         COUNT(DISTINCT cs.id)   AS coaching,
         COUNT(DISTINCT qa.id)   AS quiz,
         COUNT(DISTINCT disp.id) AS disputes,
         COUNT(DISTINCT wu.id)   AS writeups
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN submission_metadata sm_csr ON CAST(sm_csr.value AS UNSIGNED) = u.id
       LEFT JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
       LEFT JOIN submissions sub
         ON sub.id = sm_csr.submission_id AND sub.status = 'FINALIZED'
         AND sub.submitted_at BETWEEN ? AND ?
       LEFT JOIN score_snapshots ss ON ss.submission_id = sub.id
       LEFT JOIN coaching_sessions cs ON cs.csr_id = u.id AND cs.created_at BETWEEN ? AND ?
       LEFT JOIN quiz_attempts qa ON qa.user_id = u.id AND qa.submitted_at BETWEEN ? AND ?
       LEFT JOIN disputes disp ON disp.submission_id = sub.id
       LEFT JOIN write_ups wu ON wu.csr_id = u.id AND wu.created_at BETWEEN ? AND ?
       WHERE u.role_id = 3 AND u.is_active = 1 ${dc.sql}
       GROUP BY u.id, u.username, d.department_name`,
      [s, e, s, e, s, e, s, e, ...dp],
    )

    // Prior-period QA for trend
    const [priorRows] = await pool.execute<RowDataPacket[]>(
      `SELECT CAST(sm_csr.value AS UNSIGNED) AS userId,
         AVG(COALESCE(sub.total_score, ss.score)) AS qa
       FROM submissions sub
       JOIN submission_metadata sm_csr ON sm_csr.submission_id = sub.id
       JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
       LEFT JOIN score_snapshots ss ON ss.submission_id = sub.id
       WHERE sub.status = 'FINALIZED' AND sub.submitted_at BETWEEN ? AND ?
       GROUP BY CAST(sm_csr.value AS UNSIGNED)`,
      [ps, pe],
    )
    const priorMap = new Map<number, number>()
    for (const r of priorRows) priorMap.set(r.userId, parseFloat(r.qa ?? '0'))

    return rows.map(r => {
      const currQa  = r.qa != null ? parseFloat(r.qa) : null
      const priorQa = priorMap.get(r.userId) ?? null
      const delta   = currQa !== null && priorQa !== null ? currQa - priorQa : null
      const coaching = parseInt(r.coaching, 10)
      const expected = 4 // default expectation; driven by KPI thresholds in future
      return {
        userId:   r.userId,
        name:     r.name,
        dept:     r.dept,
        qa:       currQa,
        trend:    delta !== null ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—',
        coaching,
        quiz:     parseInt(r.quiz, 10),
        disputes: parseInt(r.disputes, 10),
        writeups: parseInt(r.writeups, 10),
        risk:     parseInt(r.writeups, 10) > 0 || parseInt(r.disputes, 10) > 2,
        cadence:  coaching,
        expected,
      }
    })
  }

  async getAgentProfile(userId: number, ranges: PeriodRanges): Promise<AgentProfile> {
    const s = fmt(ranges.current.start)
    const e = fmt(ranges.current.end)

    const [[userRow], [audits], [sessions], [quizRows], [wuRows], [dispRow]] = await Promise.all([
      pool.execute<RowDataPacket[]>(
        `SELECT u.id, u.username AS name, u.title,
           COALESCE(d.department_name,'Unknown') AS dept
         FROM users u LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.id = ?`, [userId],
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT s.id, f.form_name AS form,
           COALESCE(s.total_score, ss.score) AS score,
           DATE_FORMAT(s.submitted_at,'%Y-%m-%d') AS date,
           DATE_FORMAT(c.call_date,'%Y-%m-%d') AS callDate, s.status
         FROM submissions s
         JOIN submission_metadata sm_csr ON sm_csr.submission_id = s.id
         JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
         LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
         LEFT JOIN calls c ON s.call_id = c.id
         JOIN forms f ON s.form_id = f.id
         WHERE CAST(sm_csr.value AS UNSIGNED) = ? AND s.status = 'FINALIZED'
           AND s.submitted_at BETWEEN ? AND ?
         ORDER BY s.submitted_at DESC LIMIT 100`, [userId, s, e],
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT cs.id, DATE_FORMAT(cs.session_date,'%Y-%m-%d') AS date,
           cs.coaching_purpose AS purpose, cs.coaching_format AS format, cs.status,
           GROUP_CONCAT(li_t.label ORDER BY li_t.label SEPARATOR '||') AS topics
         FROM coaching_sessions cs
         LEFT JOIN coaching_session_topics cst ON cst.coaching_session_id = cs.id
         LEFT JOIN list_items li_t ON li_t.id = cst.topic_id
         WHERE cs.csr_id = ? AND cs.created_at BETWEEN ? AND ?
         GROUP BY cs.id ORDER BY cs.session_date DESC LIMIT 50`, [userId, s, e],
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT qa.id, qz.quiz_title AS quiz, qa.score, qa.passed,
           DATE_FORMAT(qa.submitted_at,'%Y-%m-%d') AS date, qa.attempt_number AS attempts
         FROM quiz_attempts qa JOIN quizzes qz ON qa.quiz_id = qz.id
         WHERE qa.user_id = ? AND qa.submitted_at BETWEEN ? AND ?
         ORDER BY qa.submitted_at DESC LIMIT 30`, [userId, s, e],
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT wu.id, wu.document_type AS type, wu.status,
           DATE_FORMAT(wu.created_at,'%Y-%m-%d') AS date,
           DATE_FORMAT(wu.meeting_date,'%Y-%m-%d') AS meetingDate,
           DATE_FORMAT(wu.follow_up_date,'%Y-%m-%d') AS followUpDate,
           CASE WHEN wu.linked_coaching_id IS NOT NULL THEN 1 ELSE 0 END AS linkedCoaching,
           COUNT(DISTINCT wupd.id) AS priorCount,
           GROUP_CONCAT(DISTINCT wv.policy_violated ORDER BY wv.policy_violated SEPARATOR '||') AS policies,
           mgr.username AS managerName
         FROM write_ups wu
         LEFT JOIN users mgr ON wu.manager_id = mgr.id
         LEFT JOIN write_up_prior_discipline wupd ON wupd.write_up_id = wu.id
         LEFT JOIN write_up_incidents wi ON wi.write_up_id = wu.id
         LEFT JOIN write_up_violations wv ON wv.incident_id = wi.id
         WHERE wu.csr_id = ? AND wu.created_at BETWEEN ? AND ?
         GROUP BY wu.id, wu.document_type, wu.status, wu.created_at,
                  wu.meeting_date, wu.follow_up_date, wu.linked_coaching_id, mgr.username
         ORDER BY wu.created_at DESC LIMIT 20`, [userId, s, e],
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
           SUM(CASE WHEN d.status IN ('UPHELD','REJECTED') THEN 1 ELSE 0 END) AS upheld,
           SUM(CASE WHEN d.status='ADJUSTED' THEN 1 ELSE 0 END) AS adjusted,
           SUM(CASE WHEN d.status='OPEN' THEN 1 ELSE 0 END) AS open_count,
           AVG(CASE WHEN d.resolved_at IS NOT NULL
               THEN DATEDIFF(d.resolved_at, d.created_at) END) AS avgResolutionDays
         FROM disputes d
         JOIN submissions s ON d.submission_id = s.id
         JOIN submission_metadata sm_csr ON sm_csr.submission_id = s.id
         JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
         WHERE CAST(sm_csr.value AS UNSIGNED) = ? AND d.created_at BETWEEN ? AND ?`, [userId, s, e],
      ),
    ])

    const user = userRow[0]
    if (!user) throw new Error(`User ${userId} not found`)

    const ds = dispRow[0] ?? {}
    return {
      user: { id: user.id, name: user.name, dept: user.dept, title: user.title ?? null },
      recentAudits: (audits as RowDataPacket[]).map(r => ({
        id: r.id, form: r.form,
        score: r.score != null ? parseFloat(r.score) : null,
        date: r.date, callDate: r.callDate ?? null, status: r.status,
      })),
      coachingSessions: (sessions as RowDataPacket[]).map(r => ({
        id: r.id, date: r.date, purpose: r.purpose, format: r.format ?? '', status: r.status,
        topics: r.topics ? r.topics.split('||') : [],
      })),
      quizzes: (quizRows as RowDataPacket[]).map(r => ({
        id: r.id, quiz: r.quiz,
        score: parseFloat(r.score), passed: !!r.passed,
        date: r.date, attempts: r.attempts,
      })),
      writeUps: (wuRows as RowDataPacket[]).map(r => ({
        id: r.id, type: r.type, status: r.status, date: r.date,
        meetingDate:    r.meetingDate ?? null,
        followUpDate:   r.followUpDate ?? null,
        linkedCoaching: Boolean(r.linkedCoaching),
        priorCount:     parseInt(r.priorCount ?? '0', 10),
        policies:       r.policies ? (r.policies as string).split('||') : [],
        managerName:    r.managerName ?? null,
      })),
      disputeStats: {
        total:             parseInt(ds.total ?? '0', 10),
        upheld:            parseInt(ds.upheld ?? '0', 10),
        adjusted:          parseInt(ds.adjusted ?? '0', 10),
        open:              parseInt(ds.open_count ?? '0', 10),
        avgResolutionDays: ds.avgResolutionDays != null ? parseFloat(ds.avgResolutionDays) : null,
      },
    }
  }
}

export const qcAnalyticsService = new QCAnalyticsService()
