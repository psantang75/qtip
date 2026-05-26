/**
 * Frontend rollupEngine parity test. Loads the SAME fixture file content as
 * backend/src/utils/__tests__/rollupEngine.test.ts (kept in lockstep) so the
 * two engines cannot drift undetected.
 */

import { describe, expect, it } from 'vitest'
import { deriveRollupAnswers } from '../rollupEngine'
import type { Answer, Form, FormQuestion, FormQuestionRole, FormRollupRule } from '../../../types/form.types'
import fixture from './rollupEngine.fixture.json'

interface FixtureQuestion {
  id: number
  role?: string
  rollup_rule?: string
  rollup_member_question_ids?: number[]
  is_na_allowed?: boolean
}

interface Scenario {
  name: string
  rollupId: number
  answers: Record<string, string>
  visibility: Record<string, boolean>
  expectedAnswer: 'yes' | 'no' | 'na'
  expectedVisibleMembers: number[]
  runTwice?: boolean
}

const rawQuestions = fixture.questions as FixtureQuestion[]
const scenarios = fixture.scenarios as Scenario[]

function buildForm(): Form {
  const questions: FormQuestion[] = rawQuestions.map((q) => ({
    id: q.id,
    category_id: 1,
    question_text: `Q${q.id}`,
    question_type: 'YES_NO',
    weight: 1,
    is_na_allowed: q.is_na_allowed,
    role: q.role as FormQuestionRole | undefined,
    rollup_rule: (q.rollup_rule ?? null) as FormRollupRule | null,
    rollup_member_question_ids: q.rollup_member_question_ids ?? null,
  }))
  return {
    id: 1,
    form_name: 'Fixture',
    is_active: true,
    categories: [
      { id: 1, form_id: 1, category_name: 'C1', weight: 1, questions },
    ],
  }
}

function toAnswers(record: Record<string, string>): Record<number, Answer> {
  const out: Record<number, Answer> = {}
  Object.entries(record).forEach(([k, v]) => {
    const id = Number(k)
    out[id] = { question_id: id, answer: v }
  })
  return out
}

function toVisibility(record: Record<string, boolean>): Record<number, boolean> {
  const out: Record<number, boolean> = {}
  Object.entries(record).forEach(([k, v]) => { out[Number(k)] = v })
  return out
}

describe('rollupEngine (frontend)', () => {
  scenarios.forEach((s) => {
    it(s.name, () => {
      const form = buildForm()
      const rawAnswers = toAnswers(s.answers)
      const visibility = toVisibility(s.visibility)

      const first = deriveRollupAnswers(form, rawAnswers, visibility)
      expect(first.answers[s.rollupId]?.answer).toBe(s.expectedAnswer)
      const note = first.notes.find((n) => n.questionId === s.rollupId)
      expect(note).toBeDefined()
      expect(note!.derivedAnswer).toBe(s.expectedAnswer)
      expect(note!.visibleMemberIds).toEqual(s.expectedVisibleMembers)

      if (s.runTwice) {
        const second = deriveRollupAnswers(form, first.answers, visibility)
        expect(second.answers[s.rollupId]?.answer).toBe(s.expectedAnswer)
      }
    })
  })

  it('leaves DETAIL answers untouched and does not mutate the input map', () => {
    const form = buildForm()
    const rawAnswers = toAnswers({ '101': 'yes', '102': 'no', '103': 'yes', '104': 'yes' })
    const visibility = toVisibility({ '101': true, '102': true, '103': true, '104': true })
    const before = JSON.stringify(rawAnswers)
    const result = deriveRollupAnswers(form, rawAnswers, visibility)
    expect(JSON.stringify(rawAnswers)).toBe(before)
    expect(result.answers[101].answer).toBe('yes')
    expect(result.answers[102].answer).toBe('no')
    expect(result.answers[100].answer).toBe('no')
  })

  it('forms with no ROLLUP questions are a no-op', () => {
    const form = buildForm()
    // strip ROLLUP role from every question
    form.categories[0].questions.forEach((q) => { q.role = 'DETAIL' })
    const rawAnswers = toAnswers({ '101': 'yes', '102': 'no' })
    const result = deriveRollupAnswers(form, rawAnswers, {})
    expect(result.notes).toEqual([])
    expect(result.answers).toEqual(rawAnswers)
  })
})
