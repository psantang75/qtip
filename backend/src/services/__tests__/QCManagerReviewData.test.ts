/**
 * Manager Review Items read service. The pool is mocked, so this runs without a
 * database. Guards the properties that make the report safe and correct:
 * only Agent Visible = No questions, only STANDARD submissions, pre-ack
 * statuses included, filters applied, and versions rolled up by text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RowDataPacket } from 'mysql2'

const execute = vi.fn()
vi.mock('../../config/database', () => ({
  default: { execute: (...args: unknown[]) => execute(...args) },
}))

import {
  getHiddenQuestionSummary, getHiddenAnswers, aggregateQuestions, hiddenAnswersBase, FLAGGED_EXPR,
} from '../QCManagerReviewData'

const ranges = {
  current: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59) },
  prior:   { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59) },
}

const rows = (r: Record<string, unknown>[]) => r as unknown as RowDataPacket[]

beforeEach(() => execute.mockReset())

describe('hiddenAnswersBase', () => {
  it('restricts to hidden questions, STANDARD scope, and pre-ack statuses', () => {
    const { sql } = hiddenAnswersBase([], [], ranges, 'STANDARD')
    expect(sql).toContain('fq.visible_to_csr = 0')
    expect(sql).toContain("s.status IN ('SUBMITTED','DISPUTED','FINALIZED')")
    expect(sql).toContain('s.access_mode IS NULL')
    expect(sql).toContain("fmf_csr.field_name = 'CSR'")
    expect(sql).not.toContain("s.status = 'FINALIZED'")
  })

  it('binds the period, department and form filters in order', () => {
    const { sql, params } = hiddenAnswersBase([7, 9], ['Sales Interaction QA'], ranges, 'STANDARD')
    expect(sql).toContain('AND csr.department_id IN (?,?)')
    expect(sql).toContain('AND f.form_name IN (?)')
    expect(params).toEqual(['2026-09-01 00:00:00', '2026-09-30 23:59:59', 7, 9, 'Sales Interaction QA'])
  })

  it('reads only INTERNAL submissions under INTERNAL scope', () => {
    expect(hiddenAnswersBase([], [], ranges, 'INTERNAL').sql).toContain("s.access_mode = 'INTERNAL'")
  })
})

describe('aggregateQuestions', () => {
  it('rolls versions together by form + question text and builds distributions per agent', () => {
    const result = aggregateQuestions(rows([
      { form: 'Sales Interaction QA', question: 'Refer salesperson for coaching?', type: 'YES_NO', ans: 'no',  userId: 33, name: 'Jamie', dept: 'Inbound', cnt: 3, flagged: 0 },
      { form: 'Sales Interaction QA', question: 'Refer salesperson for coaching?', type: 'YES_NO', ans: 'yes', userId: 33, name: 'Jamie', dept: 'Inbound', cnt: 1, flagged: 1 },
      { form: 'Sales Interaction QA', question: 'Refer salesperson for coaching?', type: 'YES_NO', ans: 'yes', userId: 36, name: 'Mitch', dept: 'Inbound', cnt: 2, flagged: 2 },      { form: 'Sales Interaction QA', question: 'Coaching notes/feedback for manager.', type: 'TEXT', ans: '__response__', userId: 36, name: 'Mitch', dept: 'Inbound', cnt: 2, flagged: 2 },
      { form: 'Sales Interaction QA', question: 'Coaching notes/feedback for manager.', type: 'TEXT', ans: '__empty__',    userId: 33, name: 'Jamie', dept: 'Inbound', cnt: 4, flagged: 0 },
    ]))

    expect(result).toHaveLength(2)
    const referral = result.find(q => q.type === 'YES_NO')!
    expect(referral.total).toBe(6)
    expect(referral.flagged).toBe(3)
    expect(referral.distribution).toEqual([{ answer: 'no', count: 3 }, { answer: 'yes', count: 3 }])
    expect(referral.agents.map(a => [a.name, a.total, a.flagged])).toEqual([['Mitch', 2, 2], ['Jamie', 4, 1]])

    const notes = result.find(q => q.type === 'TEXT')!
    expect(notes.total).toBe(6)
    expect(notes.responses).toBe(2)
    expect(notes.distribution).toEqual([])
  })
})

describe('FLAGGED_EXPR', () => {
  it('counts only written content, never a Yes/No answer', () => {
    expect(FLAGGED_EXPR).toContain("fq.question_type = 'TEXT'")
    expect(FLAGGED_EXPR).toContain('sa.notes')
    expect(FLAGGED_EXPR).not.toContain('YES_NO')
    expect(FLAGGED_EXPR).not.toContain("'yes'")
  })
})

describe('getHiddenQuestionSummary', () => {
  it('computes KPIs', async () => {
    execute
      .mockResolvedValueOnce([[{ reviews: 10, reviewsFlagged: 4, notes: 5 }]])
      .mockResolvedValueOnce([[]])
    const out = await getHiddenQuestionSummary([], [], ranges)
    expect(out.kpis).toEqual({ reviews: 10, reviewsFlagged: 4, notes: 5 })
    expect(out.range).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' })
  })

  it('coerces null aggregates to zero', async () => {
    execute
      .mockResolvedValueOnce([[{ reviews: 0, reviewsFlagged: 0, notes: null }]])
      .mockResolvedValueOnce([[]])
    const out = await getHiddenQuestionSummary([], [], ranges)
    expect(out.kpis).toEqual({ reviews: 0, reviewsFlagged: 0, notes: 0 })
  })
})

describe('getHiddenAnswers', () => {
  it('adds the flagged predicate only when onlyFlagged is set', async () => {
    execute.mockResolvedValue([[]])
    await getHiddenAnswers([], [], ranges, { onlyFlagged: true })
    await getHiddenAnswers([], [], ranges, { onlyFlagged: false })
    const [flaggedSql] = execute.mock.calls[0] as [string]
    const [allSql]     = execute.mock.calls[1] as [string]
    expect(flaggedSql).toContain(`AND ${FLAGGED_EXPR}`)
    expect(allSql).not.toContain(`AND ${FLAGGED_EXPR}`)
  })

  it('maps rows and coerces the flagged column to a boolean', async () => {
    execute.mockResolvedValue([[{
      submissionId: 3192, date: '2026-09-24', status: 'FINALIZED', userId: 33, agent: 'Jamie', dept: 'Inbound',
      form: 'Sales Interaction QA', question: 'Coaching notes/feedback for manager.', type: 'TEXT',
      answer: 'Work on closing.', notes: null, flagged: 1,
    }]])
    const [row] = await getHiddenAnswers([], [], ranges, { onlyFlagged: true })
    expect(row.flagged).toBe(true)
    expect(row.submissionId).toBe(3192)
  })
})
