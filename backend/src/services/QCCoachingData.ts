import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'
import { fmtDatetime as fmt } from '../utils/dateHelpers'
import { deptClause } from './qcQueryHelpers'

/**
 * QC coaching insight data layer — backs the `qc_coaching` insights page
 * (`/api/insights-qc/coaching/*` via `insightsQC.controller.ts`).
 *
 * Domain boundary (pre-production review item #70):
 *
 *   - This module is **insights-audience**: department-scoped only
 *     (`deptClause(deptFilter, 'u')`) and pre-aggregated for the QC
 *     dashboards. The HTTP layer routes through `qcHandler` +
 *     `middleware/qcCache`, and the dept filter is resolved per-user
 *     before reaching us — see `resolveDeptFilter` in
 *     `controllers/insightsQC.controller.ts`.
 *
 *   - `controllers/coachingReport.controller.ts` is the **manager-audience**
 *     surface: role-based visibility (`buildCoachingSessionScope` from
 *     `services/coachingSessionsReport.ts`) so a Manager only sees their
 *     direct reports' coaching, a CSR only sees their own, etc.
 *
 *   - `services/coachingSessionsReport.ts` owns the canonical role-scope
 *     helper that the live coaching list (`coaching.controller.ts`) and
 *     the on-demand exports also use. Do NOT add a second role-scope
 *     here — extend `buildCoachingSessionScope` and re-export it.
 *
 * If a future aggregate needs both audiences, wrap it once and let each
 * caller pass its own scope predicate; do not duplicate the SQL shape.
 */

/** Agents coached on a specific topic in the period */
export async function getCoachingTopicAgents(
  topic: string, deptFilter: number[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       COUNT(DISTINCT cs.id) AS sessions,
       MAX(DATE_FORMAT(cs.session_date,'%b %d')) AS lastCoached,
       CASE WHEN COUNT(DISTINCT cs.id) >= 2 THEN 1 ELSE 0 END AS repeat_flag
     FROM coaching_session_topics cst
     JOIN list_items li_t ON cst.topic_id = li_t.id
     JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
     JOIN users u ON cs.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE li_t.label = ? AND cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id ORDER BY sessions DESC
     LIMIT 500`,
    [topic, s, e, ...dc.params],
  )
  return rows.map(r => ({
    userId:      r.userId as number,
    name:        r.name as string,
    dept:        r.dept as string,
    sessions:    parseInt(r.sessions, 10),
    lastCoached: r.lastCoached as string | null,
    repeat:      Boolean(r.repeat_flag),
  }))
}

/** Agents with 3+ sessions including per-agent topic breakdown */
export async function getRepeatCoachingAgentsWithTopics(
  deptFilter: number[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       COUNT(DISTINCT cs.id) AS sessions,
       COUNT(DISTINCT li_t.id) AS uniqueTopics
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN coaching_session_topics cst ON cst.coaching_session_id = cs.id
     LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
     WHERE cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id HAVING sessions >= 3 ORDER BY sessions DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  if (rows.length === 0) return []

  const userIds = rows.map(r => r.userId as number)
  const ph      = userIds.map(() => '?').join(',')
  const [topicRows] = await pool.execute<RowDataPacket[]>(
    `SELECT cs.csr_id AS userId, li_t.label AS topic, COUNT(*) AS cnt
     FROM coaching_session_topics cst
     JOIN list_items li_t ON cst.topic_id = li_t.id
     JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
     WHERE cs.csr_id IN (${ph}) AND cs.created_at BETWEEN ? AND ?
     GROUP BY cs.csr_id, li_t.id ORDER BY cs.csr_id, cnt DESC`,
    [...userIds, s, e],
  )

  const topicMap = new Map<number, Array<{ topic: string; count: number }>>()
  for (const tr of topicRows) {
    const list = topicMap.get(tr.userId as number) ?? []
    list.push({ topic: tr.topic as string, count: parseInt(tr.cnt, 10) })
    topicMap.set(tr.userId as number, list)
  }

  return rows.map(r => {
    const topics       = topicMap.get(r.userId as number) ?? []
    const repeatTopics = topics.filter(t => t.count >= 2).length
    return {
      userId:       r.userId as number,
      name:         r.name as string,
      dept:         r.dept as string,
      sessions:     parseInt(r.sessions, 10),
      uniqueTopics: parseInt(r.uniqueTopics, 10),
      repeatTopics,
      topics,
    }
  })
}

/** Coaching sessions grouped by status with agent details */
export async function getSessionsByStatus(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT cs.status,
       u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       cs.coaching_purpose AS purpose,
       cs.coaching_format AS format,
       COUNT(*) AS sessions
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE cs.session_date BETWEEN ? AND ? ${dc.sql}
     GROUP BY cs.status, u.id, cs.coaching_purpose, cs.coaching_format
     ORDER BY cs.status, sessions DESC
     LIMIT 1000`,
    [s, e, ...dc.params],
  )

  const [topicRows] = await pool.execute<RowDataPacket[]>(
    `SELECT cs.status, cs.csr_id AS userId, li_t.label AS topic
     FROM coaching_sessions cs
     JOIN coaching_session_topics cst ON cst.coaching_session_id = cs.id
     JOIN list_items li_t ON cst.topic_id = li_t.id
     JOIN users u ON cs.csr_id = u.id
     WHERE cs.session_date BETWEEN ? AND ? ${dc.sql}
     GROUP BY cs.status, cs.csr_id, li_t.id`,
    [s, e, ...dc.params],
  )

  type AgentEntry = { userId: number; name: string; dept: string; purpose: string; format: string; sessions: number; topics: string[] }
  type StatusEntry = { count: number; agents: AgentEntry[]; topics: Set<string> }
  const statusMap = new Map<string, StatusEntry>()

  for (const r of rows) {
    const status = r.status as string
    const entry = statusMap.get(status) ?? { count: 0, agents: [], topics: new Set() }
    const sess = parseInt(r.sessions, 10)
    entry.count += sess
    entry.agents.push({
      userId: r.userId as number, name: r.name as string, dept: r.dept as string,
      purpose: r.purpose as string, format: r.format as string, sessions: sess, topics: [],
    })
    statusMap.set(status, entry)
  }

  for (const tr of topicRows) {
    const status = tr.status as string
    const topic = tr.topic as string
    const userId = tr.userId as number
    const entry = statusMap.get(status)
    if (!entry) continue
    entry.topics.add(topic)
    const agent = entry.agents.find(a => a.userId === userId)
    if (agent && !agent.topics.includes(topic)) agent.topics.push(topic)
  }

  return Array.from(statusMap.entries()).map(([status, data]) => ({
    status,
    count: data.count,
    topics: Array.from(data.topics),
    agents: data.agents,
  }))
}

/** Quiz breakdown with per-agent results for the expandable detail view */
export async function getQuizBreakdownWithAgents(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')

  const [quizRows] = await pool.execute<RowDataPacket[]>(
    `SELECT qz.id AS quizId, qz.quiz_title AS quiz, COUNT(qa.id) AS attempts,
       SUM(qa.passed) AS passed, AVG(qa.score) AS avgScore
     FROM quiz_attempts qa
     JOIN quizzes qz ON qa.quiz_id = qz.id
     JOIN users u ON qa.user_id = u.id
     WHERE qa.submitted_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY qz.id, qz.quiz_title ORDER BY attempts DESC
     LIMIT 200`,
    [s, e, ...dc.params],
  )

  if (quizRows.length === 0) return []

  const quizIds = quizRows.map(r => r.quizId as number)
  const ph = quizIds.map(() => '?').join(',')
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT qa.quiz_id AS quizId, u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       MAX(qa.score) AS bestScore,
       SUM(CASE WHEN qa.passed = 0 THEN 1 ELSE 0 END) AS failed,
       COUNT(*) AS attempts,
       (SELECT qa2.passed
          FROM quiz_attempts qa2
          WHERE qa2.quiz_id = qa.quiz_id
            AND qa2.user_id = u.id
            AND qa2.submitted_at BETWEEN ? AND ?
          ORDER BY qa2.submitted_at DESC
          LIMIT 1) AS currentPassed
     FROM quiz_attempts qa
     JOIN users u ON qa.user_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE qa.quiz_id IN (${ph}) AND qa.submitted_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY qa.quiz_id, u.id
     ORDER BY qa.quiz_id, currentPassed ASC, bestScore ASC`,
    [s, e, ...quizIds, s, e, ...dc.params],
  )

  const agentMap = new Map<number, Array<{ userId: number; name: string; dept: string; score: number; passed: boolean; failed: number; attempts: number }>>()
  for (const r of agentRows) {
    const qid = r.quizId as number
    const list = agentMap.get(qid) ?? []
    list.push({
      userId: r.userId as number, name: r.name as string, dept: r.dept as string,
      score: parseFloat(r.bestScore), passed: Boolean(r.currentPassed),
      failed: parseInt(r.failed ?? '0', 10), attempts: parseInt(r.attempts, 10),
    })
    agentMap.set(qid, list)
  }

  return quizRows.map(r => {
    const att = parseInt(r.attempts, 10)
    const pass = parseInt(r.passed ?? '0', 10)
    return {
      quiz: r.quiz as string,
      attempts: att,
      passed: pass,
      avgScore: r.avgScore != null ? parseFloat(r.avgScore) : null,
      passRate: att > 0 ? Math.round((pass / att) * 1000) / 10 : 0,
      agents: agentMap.get(r.quizId as number) ?? [],
    }
  })
}

/** Agents with the most failed quiz attempts in the period */
export async function getAgentsFailedQuizzes(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       COUNT(*) AS failed,
       GROUP_CONCAT(DISTINCT qz.quiz_title ORDER BY qz.quiz_title SEPARATOR '||') AS quizNames,
       AVG(qa.score) AS avgScore
     FROM quiz_attempts qa
     JOIN quizzes qz ON qa.quiz_id = qz.id
     JOIN users u ON qa.user_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE qa.passed = 0 AND qa.submitted_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id ORDER BY failed DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({
    userId:   r.userId as number,
    name:     r.name as string,
    dept:     r.dept as string,
    failed:   parseInt(r.failed, 10),
    quizzes:  r.quizNames ? (r.quizNames as string).split('||') : [],
    avgScore: r.avgScore != null ? parseFloat(r.avgScore) : null,
  }))
}

// ── Coaching insight summaries ────────────────────────────────────────────────

export async function getCoachingTopics(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT li_t.label AS topic, COUNT(DISTINCT cs.id) AS sessions,
       COUNT(DISTINCT cs.csr_id) AS agents
     FROM coaching_session_topics cst
     JOIN list_items li_t ON cst.topic_id = li_t.id
     JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
     JOIN users csr ON cs.csr_id = csr.id
     WHERE cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY li_t.id, li_t.label ORDER BY sessions DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({ topic: r.topic, sessions: parseInt(r.sessions, 10), agents: parseInt(r.agents, 10) }))
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
