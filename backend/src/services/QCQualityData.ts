import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'
import { fmtDatetime as fmt } from '../utils/dateHelpers'
import { deptClause, formClause, formFilter, CSR_JOIN } from './qcQueryHelpers'

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
  userId: number | null = null,
) {
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  const userClause  = userId !== null ? 'AND csr.id = ?' : ''
  const userParams  = userId !== null ? [userId] : []
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       fc.id                           AS category_id,
       fc.category_name                AS category_name,
       f.id                            AS form_id,
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
       ${dc.sql} ${fc.sql} ${userClause}
     GROUP BY fc.id, fc.category_name, f.id, f.form_name
     ORDER BY f.form_name, fc.sort_order`,
    [start, end, ...dc.params, ...fc.params, ...userParams],
  )
  const result = new Map<string, number | null>()
  const list = rows.map(r => {
    const earned   = parseFloat(r.earned_points)
    const possible = parseFloat(r.possible_points)
    const score    = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null
    const key = `${r.form_name}::${r.category_name}`
    result.set(key, score)
    return {
      categoryId: r.category_id as number,
      category:   r.category_name as string,
      formId:     r.form_id as number,
      form:       r.form_name as string,
      audits:     parseInt(r.audits, 10),
      avgScore:   score,
    }
  })
  return { list, scoreMap: result }
}

export async function getCategoryScores(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
  userId: number | null = null,
) {
  const [current, prior] = await Promise.all([
    queryCategoryScores(deptFilter, formNames, fmt(ranges.current.start), fmt(ranges.current.end), userId),
    queryCategoryScores(deptFilter, formNames, fmt(ranges.prior.start), fmt(ranges.prior.end), userId),
  ])
  return current.list.map(row => {
    const key = `${row.form}::${row.category}`
    const priorScore = prior.scoreMap.get(key) ?? null
    return { ...row, priorScore }
  })
}

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
  deptFilter: number[], formNames: string[], ranges: PeriodRanges, userId?: number | null,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  // Agent Profile drill-down scopes the whole report to a single auditee. In
  // that mode we drop the minimum-sample floor so any missed question can
  // surface, but still cap at the top 10 by miss rate; the org-wide Quality
  // view keeps the >=5 floor + top 10 to stay signal-dense across all agents.
  const userSql    = userId != null ? 'AND csr.id = ?' : ''
  const userParams: (string | number)[] = userId != null ? [userId] : []
  const havingSql  = userId != null ? 'HAVING missed > 0' : 'HAVING total >= 5 AND missed > 0'
  const limitSql   = 'LIMIT 10'

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
       AND fq.question_type IN ('YES_NO','SCALE','RADIO') ${dc.sql} ${fc.sql} ${userSql}
     GROUP BY fq.id, fq.question_text, f.id, f.form_name
     ${havingSql}
     ORDER BY (missed / total) DESC ${limitSql}`,
    [s, e, ...dc.params, ...fc.params, ...userParams],
  )
  if (rows.length === 0) return []

  // Single-agent scope (Agent Profile): the rows already belong to one auditee,
  // so the per-question "which agents missed this" breakdown is redundant.
  if (userId != null) {
    return rows.map(r => ({
      questionId: r.qId as number,
      question:   r.question as string,
      form:       r.form as string,
      missed:     parseInt(r.missed, 10),
      total:      parseInt(r.total, 10),
      missRate:   r.total > 0 ? Math.round((r.missed / r.total) * 1000) / 10 : 0,
      agents:     [] as Array<{ userId: number; name: string; dept: string; missed: number; total: number }>,
    }))
  }

  const qIds = rows.map(r => r.qId as number)
  const ph   = qIds.map(() => '?').join(',')
  // Re-apply dept + form filters here so the agent drill-down for each
  // question only includes audits that match the active filter — otherwise an
  // agent from a different department / form can show up under the question.
  // The base submission alias is `sub`, so we ask deptClause to scope to
  // `csr` (already aliased via the JOIN) and formFilter to scope to `sub`.
  const dcAgent = deptClause(deptFilter, 'csr')
  const ffAgent = formFilter(formNames, 'sub')
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
     ${ffAgent.join}
     WHERE sa.question_id IN (${ph})
       AND (${POSSIBLE_EXPR}) > 0
       AND sub.status = 'FINALIZED'
       AND sub.submitted_at BETWEEN ? AND ?
       ${dcAgent.sql} ${ffAgent.where}
     GROUP BY sa.question_id, csr.id, csr.username, d.department_name
     HAVING agentMissed > 0
     ORDER BY sa.question_id, agentMissed DESC, csr.username`,
    [...qIds, s, e, ...dcAgent.params, ...ffAgent.params],
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

export async function getFormScores(
  deptFilter: number[],
  ranges: PeriodRanges,
  userId?: number | null,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const userSql    = userId != null ? 'AND csr.id = ?' : ''
  const userParams: (string | number)[] = userId != null ? [userId] : []
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT f.id, f.form_name AS form,
       COUNT(DISTINCT s.id) AS submissions,
       AVG(COALESCE(s.total_score, ss.score)) AS avg_score
     FROM forms f
     JOIN submissions s ON s.form_id = f.id
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${userSql}
     GROUP BY f.id, f.form_name
     ORDER BY avg_score DESC`,
    [s, e, ...dc.params, ...userParams],
  )
  return rows.map(r => ({
    id:          r.id as number,
    form:        r.form as string,
    submissions: parseInt(r.submissions, 10),
    avgScore:    r.avg_score != null ? Math.round(parseFloat(r.avg_score) * 10) / 10 : null,
  }))
}

// Per-agent breakdown for a single form. Used by the Quality page's
// "Average Score by Form" expandable rows. Returns one row per agent that
// submitted at least one finalized audit on the given form within the period,
// ordered by lowest avg score first so coachable agents surface immediately.
export async function getFormAgentBreakdown(
  deptFilter: number[],
  formId: number,
  ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT csr.id AS userId, csr.username AS name,
       COALESCE(d.department_name, 'Unknown') AS dept,
       COUNT(DISTINCT s.id) AS audits,
       AVG(COALESCE(s.total_score, ss.score)) AS avgScore
     FROM submissions s
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     ${CSR_JOIN}
     LEFT JOIN departments d ON csr.department_id = d.id
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
       AND s.form_id = ?
       ${dc.sql}
     GROUP BY csr.id, csr.username, d.department_name
     ORDER BY avgScore ASC, csr.username`,
    [s, e, formId, ...dc.params],
  )
  return rows.map(r => ({
    userId:   r.userId as number,
    name:     r.name as string,
    dept:     r.dept as string,
    audits:   parseInt(r.audits, 10),
    avgScore: r.avgScore != null ? Math.round(parseFloat(r.avgScore) * 10) / 10 : null,
  }))
}

// Per-agent breakdown for a single (form, category) pair. Used by the Quality
// page's "Category Performance" expandable rows. Computes each agent's average
// score on that category in the period, ordered by lowest first.
export async function getCategoryAgentBreakdown(
  deptFilter: number[],
  formId: number,
  categoryId: number,
  ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT csr.id AS userId, csr.username AS name,
       COALESCE(d.department_name, 'Unknown') AS dept,
       COUNT(DISTINCT s.id) AS audits,
       SUM(${EARNED_EXPR})   AS earned_points,
       SUM(${POSSIBLE_EXPR}) AS possible_points
     FROM submission_answers sa
     JOIN form_questions fq ON sa.question_id = fq.id
     JOIN submissions     s  ON sa.submission_id = s.id
     ${CSR_JOIN}
     LEFT JOIN departments d ON csr.department_id = d.id
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
       AND s.form_id = ?
       AND fq.category_id = ?
       AND fq.question_type IN ('YES_NO','SCALE','RADIO')
       ${dc.sql}
     GROUP BY csr.id, csr.username, d.department_name
     HAVING possible_points > 0
     ORDER BY (earned_points / possible_points) ASC, csr.username`,
    [s, e, formId, categoryId, ...dc.params],
  )
  return rows.map(r => {
    const earned   = parseFloat(r.earned_points)
    const possible = parseFloat(r.possible_points)
    const avgScore = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null
    return {
      userId:   r.userId as number,
      name:     r.name as string,
      dept:     r.dept as string,
      audits:   parseInt(r.audits, 10),
      avgScore,
    }
  })
}

// Lookup helper: resolve a (form_name, category_name) pair to its category_id
// so the Category Performance expandable can pass an unambiguous identifier
// to getCategoryAgentBreakdown without leaking the id into the table response.
export async function findCategoryId(
  formId: number,
  categoryName: string,
): Promise<number | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM form_categories WHERE form_id = ? AND category_name = ? LIMIT 1`,
    [formId, categoryName],
  )
  return rows.length ? (rows[0].id as number) : null
}

export async function getQualityDeptComparison(
  deptFilter: number[], ranges: PeriodRanges, formNames: string[] = [],
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const ff = formFilter(formNames, 's')
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.department_name AS dept,
       COUNT(DISTINCT s.id) AS audits,
       AVG(COALESCE(s.total_score, ss.score)) AS avgScore,
       COUNT(DISTINCT disp.id) AS disputes
     FROM submissions s
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     ${CSR_JOIN}
     ${ff.join}
     JOIN departments d ON csr.department_id = d.id
     LEFT JOIN disputes disp ON disp.submission_id = s.id
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${ff.where}
     GROUP BY d.id, d.department_name ORDER BY avgScore DESC`,
    [s, e, ...dc.params, ...ff.params],
  )
  return rows.map(r => ({
    dept: r.dept,
    audits: parseInt(r.audits, 10),
    avgScore: r.avgScore != null ? Math.round(parseFloat(r.avgScore) * 10) / 10 : null,
    disputes: parseInt(r.disputes, 10),
  }))
}

// QA Forms Below 90% — one row per finalized audit whose overall score is
// under 90, listing the audited agent, the form, the interaction date, and the
// score. Honors the page's dept/form/period filters. Interaction date prefers
// the audited call's date, then the 'Interaction Date'/'Call Date' metadata
// field (date_value, then raw text value), and finally falls back to the
// submission (review) date so the column always shows a meaningful date.
export async function getLowScoringAudits(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  // Resolve the effective score via a scalar subquery rather than a JOIN to
  // score_snapshots: a submission can have more than one snapshot row, and a
  // JOIN would emit a duplicate audit row per snapshot (inflating the list and
  // colliding React keys). The subquery guarantees one row per submission.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.id,
       csr.id AS csr_user_id, csr.username AS agent,
       f.form_name AS form,
       COALESCE(s.total_score, (
         SELECT ss.score FROM score_snapshots ss
         WHERE ss.submission_id = s.id ORDER BY ss.id DESC LIMIT 1
       )) AS score,
       COALESCE(
         DATE_FORMAT(c.call_date, '%Y-%m-%d'),
         (
           SELECT COALESCE(DATE_FORMAT(sm2.date_value, '%Y-%m-%d'), sm2.value)
           FROM submission_metadata sm2
           JOIN form_metadata_fields fmf2 ON sm2.field_id = fmf2.id
           WHERE sm2.submission_id = s.id
             AND fmf2.field_name IN ('Interaction Date', 'Call Date')
           LIMIT 1
         ),
         DATE_FORMAT(s.submitted_at, '%Y-%m-%d')
       ) AS interaction_date
     FROM submissions s
     LEFT JOIN calls c ON c.id = s.call_id
     JOIN forms f ON s.form_id = f.id
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ?
       AND COALESCE(s.total_score, (
         SELECT ss.score FROM score_snapshots ss
         WHERE ss.submission_id = s.id ORDER BY ss.id DESC LIMIT 1
       )) < 90
       ${dc.sql} ${fc.sql}
     ORDER BY score ASC, s.submitted_at DESC`,
    [s, e, ...dc.params, ...fc.params],
  )
  return rows.map(r => ({
    id:              r.id as number,
    csrUserId:       r.csr_user_id as number,
    agent:           r.agent as string,
    form:            r.form as string,
    interactionDate: (r.interaction_date as string | null) ?? null,
    score:           r.score != null ? Math.round(parseFloat(r.score) * 10) / 10 : null,
  }))
}

// QA Forms Completed — one row per (QA auditor, CSR, form) with the count of
// finalized audits and the average QA score, honoring the page's dept/form/
// period filters. Drives the flat table above Department Comparison on the
// Quality page. Lists every QA auditor in the current scope (management view).
export async function getQAFormsCompleted(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT auditor.id AS qa_user_id, auditor.username AS qa_name,
       csr.id AS csr_user_id, csr.username AS csr_name,
       MIN(f.id) AS form_id, f.form_name,
       COUNT(DISTINCT s.id) AS completed,
       AVG(COALESCE(s.total_score, ss.score)) AS avg_score
     FROM submissions s
     LEFT JOIN score_snapshots ss ON ss.submission_id = s.id
     JOIN forms f ON s.form_id = f.id
     JOIN users auditor ON auditor.id = s.submitted_by
     ${CSR_JOIN}
     WHERE s.status = 'FINALIZED'
       AND s.submitted_at BETWEEN ? AND ? ${dc.sql} ${fc.sql}
     GROUP BY auditor.id, auditor.username, csr.id, csr.username, f.form_name
     ORDER BY qa_name, f.form_name, csr_name`,
    [s, e, ...dc.params, ...fc.params],
  )
  return rows.map(r => ({
    qaUserId:  r.qa_user_id as number,
    qaName:    r.qa_name as string,
    csrUserId: r.csr_user_id as number,
    csrName:   r.csr_name as string,
    formId:    r.form_id as number,
    form:      r.form_name as string,
    completed: parseInt(r.completed, 10),
    avgScore:  r.avg_score != null ? Math.round(parseFloat(r.avg_score) * 10) / 10 : null,
  }))
}
