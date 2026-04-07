import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function deptClause(f: number[], alias = 'csr'): { sql: string; params: number[] } {
  if (f.length === 0) return { sql: '', params: [] }
  return { sql: `AND ${alias}.department_id IN (${f.map(() => '?').join(',')})`, params: f }
}

// ── Quality page ─────────────────────────────────────────────────────────────

export async function getScoreDistribution(
  deptFilter: number[], formIds: number[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fSql = formIds.length ? `AND s.form_id IN (${formIds.map(() => '?').join(',')})` : ''
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       CASE
         WHEN s.total_score >= 90 THEN '90-100'
         WHEN s.total_score >= 80 THEN '80-89'
         WHEN s.total_score >= 70 THEN '70-79'
         WHEN s.total_score >= 60 THEN '60-69'
         ELSE 'Below 60'
       END AS bucket,
       COUNT(*) AS count
     FROM submissions s
     LEFT JOIN calls c ON s.call_id = c.id
     LEFT JOIN users csr ON c.csr_id = csr.id
     WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${fSql}
     GROUP BY bucket ORDER BY bucket`,
    [s, e, ...dc.params, ...formIds],
  )
  return rows.map(r => ({ bucket: r.bucket, count: parseInt(r.count, 10) }))
}

export async function getCategoryScores(
  deptFilter: number[], formId: number | null, ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fSql = formId ? 'AND fc.form_id = ?' : ''
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT fc.category_name,
       COUNT(DISTINCT s.id) AS audits,
       AVG(
         CASE fq.question_type
           WHEN 'YES_NO' THEN CAST(sa.answer AS DECIMAL(5,2)) * 100 / fq.yes_value
           ELSE CAST(sa.answer AS DECIMAL(5,2))
         END
       ) AS avg_score
     FROM submission_answers sa
     JOIN form_questions fq ON sa.question_id = fq.id
     JOIN form_categories fc ON fq.category_id = fc.id
     JOIN submissions s ON sa.submission_id = s.id
     LEFT JOIN calls c ON s.call_id = c.id
     LEFT JOIN users csr ON c.csr_id = csr.id
     WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ?
       AND fq.question_type IN ('YES_NO','SCALE') ${dc.sql} ${fSql}
     GROUP BY fc.id, fc.category_name ORDER BY fc.sort_order`,
    [s, e, ...dc.params, ...(formId ? [formId] : [])],
  )
  return rows.map(r => ({
    category: r.category_name,
    audits:   parseInt(r.audits, 10),
    avgScore: r.avg_score != null ? parseFloat(r.avg_score) : null,
  }))
}

export async function getMissedQuestions(
  deptFilter: number[], formIds: number[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fSql = formIds.length ? `AND f.id IN (${formIds.map(() => '?').join(',')})` : ''
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT fq.id AS qId, fq.question_text AS question, f.form_name AS form,
       COUNT(*) AS total,
       SUM(CASE WHEN sa.answer = '0' OR sa.answer = 'no' THEN 1 ELSE 0 END) AS missed
     FROM submission_answers sa
     JOIN form_questions fq ON sa.question_id = fq.id
     JOIN form_categories fc ON fq.category_id = fc.id
     JOIN forms f ON fc.form_id = f.id
     JOIN submissions s ON sa.submission_id = s.id
     LEFT JOIN calls c ON s.call_id = c.id
     LEFT JOIN users csr ON c.csr_id = csr.id
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
       AND fq.question_type = 'YES_NO' ${dc.sql} ${fSql}
     GROUP BY fq.id, f.id
     HAVING total >= 5
     ORDER BY (missed / total) DESC LIMIT 10`,
    [s, e, ...dc.params, ...formIds],
  )
  if (rows.length === 0) return []

  // Fetch agents who missed each question in a single batch query
  const qIds = rows.map(r => r.qId as number)
  const ph   = qIds.map(() => '?').join(',')
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT sa.question_id AS qId, u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept
     FROM submission_answers sa
     JOIN submissions sub ON sa.submission_id = sub.id
     LEFT JOIN calls c ON sub.call_id = c.id
     LEFT JOIN users u ON c.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE sa.question_id IN (${ph})
       AND (sa.answer = '0' OR sa.answer = 'no')
       AND sub.status = 'FINALIZED'
       AND sub.submitted_at BETWEEN ? AND ?
     ORDER BY sa.question_id, u.username`,
    [...qIds, s, e],
  )
  const agentMap = new Map<number, Array<{ userId: number; name: string; dept: string }>>()
  for (const ar of agentRows) {
    const list = agentMap.get(ar.qId as number) ?? []
    if (!list.some(a => a.userId === ar.userId)) {
      list.push({ userId: ar.userId as number, name: ar.name as string, dept: ar.dept as string })
    }
    agentMap.set(ar.qId as number, list)
  }

  return rows.map(r => ({
    questionId: r.qId as number,
    question:   r.question as string,
    form:       r.form as string,
    missRate:   r.total > 0 ? Math.round((r.missed / r.total) * 1000) / 10 : 0,
    agents:     (agentMap.get(r.qId as number) ?? []).slice(0, 10),
  }))
}

export async function getFormScores(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT f.id, f.form_name AS form,
       COUNT(DISTINCT s.id) AS submissions,
       AVG(s.total_score)   AS avg_score
     FROM forms f
     JOIN submissions s ON s.form_id = f.id
     LEFT JOIN calls c ON s.call_id = c.id
     LEFT JOIN users csr ON c.csr_id = csr.id
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY f.id, f.form_name
     ORDER BY avg_score DESC`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({
    id:          r.id as number,
    form:        r.form as string,
    submissions: parseInt(r.submissions, 10),
    avgScore:    r.avg_score != null ? parseFloat(r.avg_score) : null,
  }))
}

export async function getQualityDeptComparison(ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.department_name AS dept,
       COUNT(DISTINCT s.id) AS audits,
       AVG(s.total_score) AS avgScore,
       COUNT(DISTINCT disp.id) AS disputes
     FROM departments d
     JOIN users u ON u.department_id = d.id
     LEFT JOIN calls c ON c.csr_id = u.id
     LEFT JOIN submissions s
       ON s.call_id = c.id AND s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
     LEFT JOIN disputes disp ON disp.submission_id = s.id
     WHERE u.role_id = 3
     GROUP BY d.id, d.department_name ORDER BY avgScore DESC`,
    [s, e],
  )
  return rows.map(r => ({
    dept: r.dept,
    audits: parseInt(r.audits, 10),
    avgScore: r.avgScore != null ? parseFloat(r.avgScore) : null,
    disputes: parseInt(r.disputes, 10),
  }))
}

// ── Coaching page ─────────────────────────────────────────────────────────────

export async function getCoachingTopics(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.topic_name AS topic, COUNT(DISTINCT cs.id) AS sessions,
       COUNT(DISTINCT cs.csr_id) AS agents
     FROM coaching_session_topics cst
     JOIN topics t ON cst.topic_id = t.id
     JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
     JOIN users csr ON cs.csr_id = csr.id
     WHERE cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY t.id, t.topic_name ORDER BY sessions DESC LIMIT 15`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({ topic: r.topic, sessions: parseInt(r.sessions, 10), agents: parseInt(r.agents, 10) }))
}

export async function getRepeatCoachingAgents(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       COUNT(cs.id) AS sessions
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id HAVING sessions >= 3 ORDER BY sessions DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({ userId: r.userId, name: r.name, dept: r.dept, sessions: parseInt(r.sessions, 10) }))
}

export async function getQuizBreakdown(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT qz.quiz_title AS quiz, COUNT(qa.id) AS attempts,
       SUM(qa.passed) AS passed, AVG(qa.score) AS avgScore
     FROM quiz_attempts qa
     JOIN quizzes qz ON qa.quiz_id = qz.id
     JOIN users u ON qa.user_id = u.id
     WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY qz.id, qz.quiz_title ORDER BY attempts DESC`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({
    quiz: r.quiz,
    attempts: parseInt(r.attempts, 10),
    passed: parseInt(r.passed ?? '0', 10),
    avgScore: r.avgScore != null ? parseFloat(r.avgScore) : null,
    passRate: r.attempts > 0 ? Math.round((r.passed / r.attempts) * 1000) / 10 : 0,
  }))
}

export async function getCoachingDeptComparison(ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.department_name AS dept,
       COUNT(cs.id) AS sessions,
       SUM(CASE WHEN cs.status IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END) AS completed,
       AVG(DATEDIFF(cs.completed_at, cs.created_at)) AS avgDays
     FROM departments d
     JOIN users u ON u.department_id = d.id
     LEFT JOIN coaching_sessions cs ON cs.csr_id = u.id AND cs.created_at BETWEEN ? AND ?
     WHERE u.role_id = 3
     GROUP BY d.id, d.department_name ORDER BY completed DESC`,
    [s, e],
  )
  return rows.map(r => ({
    dept: r.dept,
    sessions: parseInt(r.sessions, 10),
    completed: parseInt(r.completed ?? '0', 10),
    avgDays: r.avgDays != null ? parseFloat(r.avgDays) : null,
  }))
}

// ── Warnings page ─────────────────────────────────────────────────────────────

export async function getWriteUpPipeline(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const dp = dc.params

  const [[statusRows], [typeRows], [statsRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT wu.status, COUNT(*) AS count FROM write_ups wu
       JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} GROUP BY wu.status`,
      [s, e, ...dp],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT wu.document_type AS type, COUNT(*) AS count FROM write_ups wu
       JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} GROUP BY wu.document_type`,
      [s, e, ...dp],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT
         AVG(CASE WHEN wu.status = 'CLOSED' THEN DATEDIFF(wu.closed_at, wu.created_at) END) AS avgDaysToClose,
         SUM(CASE WHEN wu.follow_up_required = 1 AND wu.status NOT IN ('CLOSED') THEN 1 ELSE 0 END) AS pendingFollowUps,
         SUM(CASE WHEN wu.follow_up_required = 1 AND wu.follow_up_date < CURDATE()
               AND wu.status NOT IN ('CLOSED') THEN 1 ELSE 0 END) AS overdueFollowUps
       FROM write_ups wu JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}`,
      [s, e, ...dp],
    ),
  ])

  const byStatus: Record<string, number> = {}
  for (const r of statusRows) byStatus[r.status] = parseInt(r.count, 10)
  const byType: Record<string, number> = {}
  for (const r of typeRows) byType[r.type] = parseInt(r.count, 10)
  const st = statsRows[0] ?? {}

  return {
    byStatus,
    byType,
    total:           Object.values(byStatus).reduce((a, b) => a + b, 0),
    avgDaysToClose:  st.avgDaysToClose != null ? parseFloat(st.avgDaysToClose) : null,
    pendingFollowUps:  parseInt(st.pendingFollowUps ?? '0', 10),
    overdueFollowUps:  parseInt(st.overdueFollowUps ?? '0', 10),
  }
}

export async function getActiveWriteUps(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT wu.id, u.id AS userId, u.username AS agent,
       COALESCE(d.department_name,'Unknown') AS dept,
       wu.document_type AS type, wu.status,
       DATE_FORMAT(wu.created_at,'%Y-%m-%d') AS date,
       DATE_FORMAT(wu.meeting_date,'%Y-%m-%d') AS meetingDate,
       DATE_FORMAT(wu.follow_up_date,'%Y-%m-%d') AS followUpDate,
       COUNT(DISTINCT wupd.id) AS priorCount,
       GROUP_CONCAT(DISTINCT wv.policy_violated ORDER BY wv.policy_violated SEPARATOR '||') AS policies
     FROM write_ups wu
     JOIN users u ON wu.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN write_up_prior_discipline wupd ON wupd.write_up_id = wu.id
     LEFT JOIN write_up_incidents wi ON wi.write_up_id = wu.id
     LEFT JOIN write_up_violations wv ON wv.incident_id = wi.id
     WHERE wu.created_at BETWEEN ? AND ?
       AND wu.status NOT IN ('CLOSED') ${dc.sql}
     GROUP BY wu.id, u.id, d.department_name, wu.document_type, wu.status, wu.created_at, wu.meeting_date, wu.follow_up_date
     ORDER BY wu.created_at DESC LIMIT 50`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({
    id:          r.id as number,
    userId:      r.userId as number,
    agent:       r.agent as string,
    dept:        r.dept as string,
    type:        r.type as string,
    status:      r.status as string,
    date:        r.date as string,
    meetingDate: r.meetingDate as string | null,
    followUpDate: r.followUpDate as string | null,
    priorCount:  parseInt(r.priorCount ?? '0', 10),
    policies:    r.policies ? (r.policies as string).split('||') : [],
  }))
}

export async function getEscalationData(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT wu.document_type AS type, COUNT(*) AS count
     FROM write_ups wu JOIN users csr ON wu.csr_id = csr.id
     WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY wu.document_type`,
    [s, e, ...dc.params],
  )
  const map: Record<string, number> = {}
  for (const r of rows) map[r.type] = parseInt(r.count, 10)
  return {
    verbal:  map['VERBAL_WARNING']  ?? 0,
    written: map['WRITTEN_WARNING'] ?? 0,
    final:   map['FINAL_WARNING']   ?? 0,
  }
}

export async function getPolicyViolations(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)

  // Get policy aggregates
  const [policyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wv.policy_violated AS policy, COUNT(*) AS count,
       COUNT(DISTINCT wu.csr_id) AS agentCount
     FROM write_up_violations wv
     JOIN write_up_incidents wi ON wv.incident_id = wi.id
     JOIN write_ups wu ON wi.write_up_id = wu.id
     JOIN users u ON wu.csr_id = u.id
     WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY wv.policy_violated ORDER BY count DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  if (policyRows.length === 0) return []

  // Get agent details for each policy in a single query
  const policies = policyRows.map(r => r.policy as string)
  const ph       = policies.map(() => '?').join(',')
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT wv.policy_violated AS policy, u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       wu.document_type AS type, wu.status
     FROM write_up_violations wv
     JOIN write_up_incidents wi ON wv.incident_id = wi.id
     JOIN write_ups wu ON wi.write_up_id = wu.id
     JOIN users u ON wu.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE wv.policy_violated IN (${ph}) AND wu.created_at BETWEEN ? AND ?
     ORDER BY wv.policy_violated, u.username`,
    [...policies, s, e],
  )

  const agentMap = new Map<string, Array<{ userId: number; name: string; dept: string; type: string; status: string }>>()
  for (const ar of agentRows) {
    const list = agentMap.get(ar.policy as string) ?? []
    if (!list.some(a => a.userId === ar.userId)) {
      list.push({ userId: ar.userId as number, name: ar.name as string, dept: ar.dept as string, type: ar.type as string, status: ar.status as string })
    }
    agentMap.set(ar.policy as string, list)
  }

  return policyRows.map(r => ({
    policy:       r.policy as string,
    count:        parseInt(r.count, 10),
    agentCount:   parseInt(r.agentCount, 10),
    agentDetails: agentMap.get(r.policy as string) ?? [],
  }))
}

export async function getWarningsDeptComparison(ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.department_name AS dept,
       COUNT(wu.id) AS writeups,
       SUM(CASE WHEN wu.status = 'CLOSED' THEN 1 ELSE 0 END) AS closed
     FROM departments d
     JOIN users u ON u.department_id = d.id
     LEFT JOIN write_ups wu ON wu.csr_id = u.id AND wu.created_at BETWEEN ? AND ?
     WHERE u.role_id = 3
     GROUP BY d.id, d.department_name ORDER BY writeups DESC`,
    [s, e],
  )
  return rows.map(r => ({
    dept: r.dept,
    writeups: parseInt(r.writeups, 10),
    closed: parseInt(r.closed ?? '0', 10),
    resolutionRate: r.writeups > 0 ? Math.round((r.closed / r.writeups) * 1000) / 10 : 0,
  }))
}
