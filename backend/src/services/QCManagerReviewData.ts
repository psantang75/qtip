import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'
import { fmtDatetime as fmt } from '../utils/dateHelpers'
import { deptClause, formClause, CSR_JOIN } from './qcQueryHelpers'
import { accessScopeClause, type AccessScope } from '../utils/formScope'

// Manager Review Items: answers to questions marked Agent Visible = No
// (form_questions.visible_to_csr = 0). Not limited to FINALIZED — managers need
// manager-only notes before the agent acknowledges the review. Question ids
// change with every form version, so questions are grouped by form name +
// question text to roll all versions together.
//
// The form builder has no "flag" concept on answers, so a hidden Yes/No answer
// carries no inherent meaning. Only written content (a hidden TEXT response or
// a reviewer note on a hidden question) counts as a manager item.

const TEXT_PRESENT  = `TRIM(COALESCE(sa.answer, '')) <> ''`
const NOTES_PRESENT = `TRIM(COALESCE(sa.notes, '')) <> ''`
export const FLAGGED_EXPR =
  `((fq.question_type = 'TEXT' AND ${TEXT_PRESENT}) OR ${NOTES_PRESENT})`

export function hiddenAnswersBase(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges, accessScope: AccessScope,
): { sql: string; params: (string | number)[] } {
  const dc = deptClause(deptFilter)
  const fc = formClause(formNames)
  return {
    sql: `FROM submission_answers sa
      JOIN form_questions  fq ON sa.question_id  = fq.id
      JOIN form_categories fc ON fq.category_id  = fc.id
      JOIN forms            f ON fc.form_id      = f.id
      JOIN submissions      s ON sa.submission_id = s.id
      ${CSR_JOIN}
      LEFT JOIN departments d ON csr.department_id = d.id
      WHERE fq.visible_to_csr = 0
        AND fq.question_type NOT IN ('INFO_BLOCK','SUB_CATEGORY')
        AND s.status IN ('SUBMITTED','DISPUTED','FINALIZED')
        AND s.submitted_at BETWEEN ? AND ?
        ${dc.sql} ${fc.sql} ${accessScopeClause(accessScope, 's')}`,
    params: [fmt(ranges.current.start), fmt(ranges.current.end), ...dc.params, ...fc.params],
  }
}

export interface ManagerReviewKpis {
  reviews: number; reviewsFlagged: number; notes: number
}
export interface HiddenQuestionAgent {
  userId: number; name: string; dept: string; total: number; responses: number; flagged: number
}
export interface HiddenQuestionSummary {
  key: string; form: string; question: string; type: string
  total: number; responses: number; flagged: number
  distribution: Array<{ answer: string; count: number }>
  agents: HiddenQuestionAgent[]
}

const RESPONSE = '__response__'
const EMPTY    = '__empty__'

export async function getHiddenQuestionSummary(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
  accessScope: AccessScope = 'STANDARD',
): Promise<{ kpis: ManagerReviewKpis; questions: HiddenQuestionSummary[]; range: { startDate: string; endDate: string } }> {
  const base = hiddenAnswersBase(deptFilter, formNames, ranges, accessScope)
  const range = { startDate: fmt(ranges.current.start).split(' ')[0], endDate: fmt(ranges.current.end).split(' ')[0] }
  const [[kpiRows], [rows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT s.id) AS reviews,
         COUNT(DISTINCT CASE WHEN ${FLAGGED_EXPR} THEN s.id END) AS reviewsFlagged,
         SUM(${FLAGGED_EXPR}) AS notes
       ${base.sql}`,
      base.params,
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT f.form_name AS form, fq.question_text AS question, fq.question_type AS type,
         CASE WHEN fq.question_type = 'TEXT'
              THEN IF(${TEXT_PRESENT}, '${RESPONSE}', '${EMPTY}')
              ELSE IF(${TEXT_PRESENT}, LOWER(TRIM(sa.answer)), '${EMPTY}') END AS ans,
         csr.id AS userId, csr.username AS name, COALESCE(d.department_name, 'Unknown') AS dept,
         COUNT(*) AS cnt,
         SUM(${FLAGGED_EXPR}) AS flagged
       ${base.sql}
       GROUP BY f.form_name, fq.question_text, fq.question_type, ans, csr.id, csr.username, d.department_name
       ORDER BY f.form_name, fq.question_text`,
      base.params,
    ),
  ])

  const k = kpiRows[0] ?? {}
  const kpis: ManagerReviewKpis = {
    reviews:        Number(k.reviews ?? 0),
    reviewsFlagged: Number(k.reviewsFlagged ?? 0),
    notes:          Number(k.notes ?? 0),
  }
  return { kpis, questions: aggregateQuestions(rows), range }
}

export function aggregateQuestions(rows: RowDataPacket[]): HiddenQuestionSummary[] {
  const map = new Map<string, HiddenQuestionSummary & { dist: Map<string, number>; agentMap: Map<number, HiddenQuestionAgent> }>()
  for (const r of rows) {
    const key = `${r.form}::${r.question}`
    let q = map.get(key)
    if (!q) {
      q = { key, form: r.form, question: r.question, type: r.type, total: 0, responses: 0, flagged: 0,
            distribution: [], agents: [], dist: new Map(), agentMap: new Map() }
      map.set(key, q)
    }
    const cnt     = Number(r.cnt)
    const flagged = Number(r.flagged)
    const answered = r.ans !== EMPTY
    q.total     += cnt
    q.flagged   += flagged
    if (answered) q.responses += cnt
    if (answered && r.ans !== RESPONSE) q.dist.set(r.ans, (q.dist.get(r.ans) ?? 0) + cnt)

    const a = q.agentMap.get(r.userId) ?? { userId: r.userId, name: r.name, dept: r.dept, total: 0, responses: 0, flagged: 0 }
    a.total   += cnt
    a.flagged += flagged
    if (answered) a.responses += cnt
    q.agentMap.set(r.userId, a)
  }
  return [...map.values()].map(({ dist, agentMap, ...q }) => ({
    ...q,
    distribution: [...dist.entries()].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count),
    agents: [...agentMap.values()].sort((a, b) => b.flagged - a.flagged || a.name.localeCompare(b.name)),
  }))
}

export interface HiddenAnswerRow {
  submissionId: number; date: string; status: string
  userId: number; agent: string; dept: string
  form: string; question: string; type: string
  answer: string | null; notes: string | null; flagged: boolean
}

// Defensive cap: this is a dashboard grid, not an export surface.
const ANSWERS_LIMIT = 1000

export async function getHiddenAnswers(
  deptFilter: number[], formNames: string[], ranges: PeriodRanges,
  opts: { onlyFlagged: boolean }, accessScope: AccessScope = 'STANDARD',
): Promise<HiddenAnswerRow[]> {
  const base = hiddenAnswersBase(deptFilter, formNames, ranges, accessScope)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.id AS submissionId, DATE_FORMAT(s.submitted_at, '%Y-%m-%d') AS date, s.status,
       csr.id AS userId, csr.username AS agent, COALESCE(d.department_name, 'Unknown') AS dept,
       f.form_name AS form, fq.question_text AS question, fq.question_type AS type,
       sa.answer, sa.notes, ${FLAGGED_EXPR} AS flagged
     ${base.sql} ${opts.onlyFlagged ? `AND ${FLAGGED_EXPR}` : ''}
     ORDER BY s.submitted_at DESC, s.id DESC, fc.sort_order, fq.sort_order
     LIMIT ${ANSWERS_LIMIT}`,
    base.params,
  )
  return rows.map(r => ({
    submissionId: r.submissionId as number,
    date:         r.date as string,
    status:       r.status as string,
    userId:       r.userId as number,
    agent:        r.agent as string,
    dept:         r.dept as string,
    form:         r.form as string,
    question:     r.question as string,
    type:         r.type as string,
    answer:       (r.answer as string | null) ?? null,
    notes:        (r.notes as string | null) ?? null,
    flagged:      Number(r.flagged) === 1,
  }))
}
