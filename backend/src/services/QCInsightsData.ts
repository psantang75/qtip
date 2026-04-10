import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'
import { fmtDatetime as fmt } from '../utils/dateHelpers'

function deptClause(f: number[], alias = 'csr'): { sql: string; params: number[] } {
  if (f.length === 0) return { sql: '', params: [] }
  return { sql: `AND ${alias}.department_id IN (${f.map(() => '?').join(',')})`, params: f }
}

function formClause(names: string[], alias = 'f'): { sql: string; params: string[] } {
  if (names.length === 0) return { sql: '', params: [] }
  return { sql: `AND ${alias}.form_name IN (${names.map(() => '?').join(',')})`, params: names }
}

// Reusable SQL fragment: resolve the audited CSR from submission_metadata
const CSR_JOIN = `
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
  JOIN users csr ON csr.id = CAST(sm_csr.value AS UNSIGNED)`

// ── Filter options (cross-filtered) ──────────────────────────────────────────

export async function getFilterOptions(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)

  // Departments available: filtered by period + selected forms (NOT by dept)
  const fc = formClause(formNames)
  const [deptRows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT d.department_name
     FROM submissions s
     JOIN forms f ON s.form_id = f.id
     ${CSR_JOIN}
     JOIN departments d ON csr.department_id = d.id
     WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${fc.sql}
     ORDER BY d.department_name`,
    [s, e, ...fc.params],
  )

  // Forms available: filtered by period + selected depts (NOT by form)
  const dc = deptClause(deptFilter)
  const [formRows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT f.form_name
     FROM submissions s
     JOIN forms f ON s.form_id = f.id
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql}
     ORDER BY f.form_name`,
    [s, e, ...dc.params],
  )

  return {
    departments: deptRows.map(r => r.department_name as string),
    forms:       formRows.map(r => r.form_name as string),
  }
}

// ── Quality page ─────────────────────────────────────────────────────────────

export async function getScoreDistribution(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       CASE
         WHEN COALESCE(s.total_score, ss.score) >= 90 THEN '90-100'
         WHEN COALESCE(s.total_score, ss.score) >= 80 THEN '80-89'
         WHEN COALESCE(s.total_score, ss.score) >= 70 THEN '70-79'
         WHEN COALESCE(s.total_score, ss.score) >= 60 THEN '60-69'
         ELSE 'Below 60'
       END AS bucket,
       COUNT(*) AS count
     FROM submissions s
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     JOIN forms f ON s.form_id = f.id
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED' AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${fc.sql}
     GROUP BY bucket ORDER BY bucket`,
    [s, e, ...dc.params, ...fc.params],
  )
  return rows.map(r => ({ bucket: r.bucket, count: parseInt(r.count, 10) }))
}

async function queryCategoryScores(
  deptFilter: number[], formNames: string[], start: string, end: string,
) {
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       fc.category_name                AS category_name,
       f.form_name                     AS form_name,
       COUNT(DISTINCT s.id)            AS audits,
       SUM(
         CASE fq.question_type
           WHEN 'YES_NO' THEN
             CASE LOWER(sa.answer)
               WHEN 'yes' THEN COALESCE(fq.yes_value, 0)
               WHEN 'no'  THEN COALESCE(fq.no_value,  0)
               WHEN 'n/a' THEN COALESCE(fq.na_value,  0)
               ELSE 0
             END
           WHEN 'SCALE' THEN COALESCE(CAST(sa.answer AS DECIMAL(5,2)), 0)
           WHEN 'RADIO' THEN COALESCE((
             SELECT ro.score FROM radio_options ro
             WHERE ro.question_id = fq.id AND ro.option_value = sa.answer
             LIMIT 1
           ), 0)
           ELSE 0
         END
       )                               AS earned_points,
       SUM(
         CASE fq.question_type
           WHEN 'YES_NO' THEN COALESCE(fq.yes_value, 0)
           WHEN 'SCALE'  THEN COALESCE(fq.scale_max, 5)
           WHEN 'RADIO'  THEN COALESCE((
             SELECT MAX(ro.score) FROM radio_options ro
             WHERE ro.question_id = fq.id
           ), 0)
           ELSE 0
         END
       )                               AS possible_points
     FROM submission_answers sa
     JOIN form_questions   fq ON sa.question_id  = fq.id
     JOIN form_categories  fc ON fq.category_id  = fc.id
     JOIN forms             f ON fc.form_id       = f.id
     JOIN submissions       s ON sa.submission_id = s.id
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
       AND fq.question_type IN ('YES_NO','SCALE','RADIO')
       ${dc.sql} ${fc.sql}
     GROUP BY fc.id, fc.category_name, f.id, f.form_name
     ORDER BY f.form_name, fc.sort_order`,
    [start, end, ...dc.params, ...fc.params],
  )
  const result = new Map<string, number | null>()
  const list = rows.map(r => {
    const earned   = parseFloat(r.earned_points)
    const possible = parseFloat(r.possible_points)
    const score    = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null
    const key = `${r.form_name}::${r.category_name}`
    result.set(key, score)
    return {
      category: r.category_name as string,
      form:     r.form_name     as string,
      audits:   parseInt(r.audits, 10),
      avgScore: score,
    }
  })
  return { list, scoreMap: result }
}

export async function getCategoryScores(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
) {
  const [current, prior] = await Promise.all([
    queryCategoryScores(deptFilter, formNames, fmt(ranges.current.start), fmt(ranges.current.end)),
    queryCategoryScores(deptFilter, formNames, fmt(ranges.prior.start), fmt(ranges.prior.end)),
  ])
  return current.list.map(row => {
    const key = `${row.form}::${row.category}`
    const priorScore = prior.scoreMap.get(key) ?? null
    return { ...row, priorScore }
  })
}

// Compute the earned score for a single answer row using the same logic as scoringUtil.
// Possible > 0 means the question was active/visible; earned = 0 means it was missed.
const EARNED_EXPR = `
  CASE fq.question_type
    WHEN 'YES_NO' THEN
      CASE LOWER(sa.answer)
        WHEN 'yes' THEN COALESCE(fq.yes_value, 0)
        WHEN 'no'  THEN COALESCE(fq.no_value,  0)
        WHEN 'n/a' THEN COALESCE(fq.na_value,  0)
        ELSE 0
      END
    WHEN 'SCALE' THEN COALESCE(CAST(sa.answer AS DECIMAL(5,2)), 0)
    WHEN 'RADIO' THEN COALESCE((
      SELECT ro.score FROM radio_options ro
      WHERE ro.question_id = fq.id AND ro.option_value = sa.answer LIMIT 1
    ), 0)
    ELSE 0
  END`

const POSSIBLE_EXPR = `
  CASE fq.question_type
    WHEN 'YES_NO' THEN COALESCE(fq.yes_value, 0)
    WHEN 'SCALE'  THEN COALESCE(fq.scale_max, 5)
    WHEN 'RADIO'  THEN COALESCE((
      SELECT MAX(ro.score) FROM radio_options ro WHERE ro.question_id = fq.id
    ), 0)
    ELSE 0
  END`

export async function getMissedQuestions(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)

  // A "scored appearance" is an answer where possible > 0 (question was active).
  // A "miss" is a scored appearance where earned = 0.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT fq.id AS qId, fq.question_text AS question, f.form_name AS form,
       SUM(CASE WHEN (${POSSIBLE_EXPR}) > 0 THEN 1 ELSE 0 END) AS total,
       SUM(CASE WHEN (${POSSIBLE_EXPR}) > 0 AND (${EARNED_EXPR}) = 0 THEN 1 ELSE 0 END) AS missed
     FROM submission_answers sa
     JOIN form_questions fq ON sa.question_id = fq.id
     JOIN form_categories fc ON fq.category_id = fc.id
     JOIN forms f ON fc.form_id = f.id
     JOIN submissions s ON sa.submission_id = s.id
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
       AND fq.question_type IN ('YES_NO','SCALE','RADIO') ${dc.sql} ${fc.sql}
     GROUP BY fq.id, fq.question_text, f.id, f.form_name
     HAVING total >= 5 AND missed > 0
     ORDER BY (missed / total) DESC LIMIT 10`,
    [s, e, ...dc.params, ...fc.params],
  )
  if (rows.length === 0) return []

  const qIds = rows.map(r => r.qId as number)
  const ph   = qIds.map(() => '?').join(',')
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT sa.question_id AS qId, csr.id AS userId, csr.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       SUM(CASE WHEN (${POSSIBLE_EXPR}) > 0 THEN 1 ELSE 0 END) AS agentTotal,
       SUM(CASE WHEN (${POSSIBLE_EXPR}) > 0 AND (${EARNED_EXPR}) = 0 THEN 1 ELSE 0 END) AS agentMissed
     FROM submission_answers sa
     JOIN form_questions fq ON sa.question_id = fq.id
     JOIN submissions sub ON sa.submission_id = sub.id
     JOIN submission_metadata sm2 ON sm2.submission_id = sub.id
     JOIN form_metadata_fields fmf2 ON sm2.field_id = fmf2.id AND fmf2.field_name = 'CSR'
     JOIN users csr ON csr.id = CAST(sm2.value AS UNSIGNED)
     LEFT JOIN departments d ON csr.department_id = d.id
     WHERE sa.question_id IN (${ph})
       AND (${POSSIBLE_EXPR}) > 0
       AND sub.status = 'FINALIZED'
       AND sub.submitted_at BETWEEN ? AND ?
     GROUP BY sa.question_id, csr.id, csr.username, d.department_name
     HAVING agentMissed > 0
     ORDER BY sa.question_id, agentMissed DESC, csr.username`,
    [...qIds, s, e],
  )
  const agentMap = new Map<number, Array<{ userId: number; name: string; dept: string; missed: number; total: number }>>()
  for (const ar of agentRows) {
    const list = agentMap.get(ar.qId as number) ?? []
    list.push({
      userId: ar.userId as number,
      name:   ar.name as string,
      dept:   ar.dept as string,
      missed: parseInt(ar.agentMissed, 10),
      total:  parseInt(ar.agentTotal, 10),
    })
    agentMap.set(ar.qId as number, list)
  }

  return rows.map(r => ({
    questionId: r.qId as number,
    question:   r.question as string,
    form:       r.form as string,
    missed:     parseInt(r.missed, 10),
    total:      parseInt(r.total, 10),
    missRate:   r.total > 0 ? Math.round((r.missed / r.total) * 1000) / 10 : 0,
    agents:     (agentMap.get(r.qId as number) ?? []).slice(0, 15),
  }))
}

export async function getFormScores(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT f.id, f.form_name AS form,
       COUNT(DISTINCT s.id) AS submissions,
       AVG(COALESCE(s.total_score, ss.score)) AS avg_score
     FROM forms f
     JOIN submissions s ON s.form_id = f.id
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     ${CSR_JOIN}
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
    avgScore:    r.avg_score != null ? Math.round(parseFloat(r.avg_score) * 10) / 10 : null,
  }))
}

export async function getQualityDeptComparison(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.department_name AS dept,
       COUNT(DISTINCT s.id) AS audits,
       AVG(COALESCE(s.total_score, ss.score)) AS avgScore,
       COUNT(DISTINCT disp.id) AS disputes
     FROM submissions s
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     ${CSR_JOIN}
     JOIN departments d ON csr.department_id = d.id
     LEFT JOIN disputes disp ON disp.submission_id = s.id
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY d.id, d.department_name ORDER BY avgScore DESC`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({
    dept: r.dept,
    audits: parseInt(r.audits, 10),
    avgScore: r.avgScore != null ? Math.round(parseFloat(r.avgScore) * 10) / 10 : null,
    disputes: parseInt(r.disputes, 10),
  }))
}

// ── Coaching page ─────────────────────────────────────────────────────────────

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
