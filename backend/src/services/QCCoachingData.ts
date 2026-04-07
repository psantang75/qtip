import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function deptClause(f: number[], alias = 'u'): { sql: string; params: number[] } {
  if (f.length === 0) return { sql: '', params: [] }
  return { sql: `AND ${alias}.department_id IN (${f.map(() => '?').join(',')})`, params: f }
}

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
     JOIN topics t  ON cst.topic_id = t.id
     JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
     JOIN users u ON cs.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE t.topic_name = ? AND cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id ORDER BY sessions DESC`,
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
       COUNT(DISTINCT t.id) AS uniqueTopics
     FROM coaching_sessions cs
     JOIN users u ON cs.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN coaching_session_topics cst ON cst.coaching_session_id = cs.id
     LEFT JOIN topics t ON cst.topic_id = t.id
     WHERE cs.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id HAVING sessions >= 3 ORDER BY sessions DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  if (rows.length === 0) return []

  const userIds = rows.map(r => r.userId as number)
  const ph      = userIds.map(() => '?').join(',')
  const [topicRows] = await pool.execute<RowDataPacket[]>(
    `SELECT cs.csr_id AS userId, t.topic_name AS topic, COUNT(*) AS cnt
     FROM coaching_session_topics cst
     JOIN topics t ON cst.topic_id = t.id
     JOIN coaching_sessions cs ON cst.coaching_session_id = cs.id
     WHERE cs.csr_id IN (${ph}) AND cs.created_at BETWEEN ? AND ?
     GROUP BY cs.csr_id, t.id ORDER BY cs.csr_id, cnt DESC`,
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
