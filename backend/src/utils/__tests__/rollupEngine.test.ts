/**
 * Backend rollupEngine parity test. Drives the engine through the shared
 * fixture (also consumed by the frontend test) so the two implementations
 * stay in lockstep.
 */

import { describe, expect, it } from 'vitest'
import { deriveRollupAnswers, type RollupQuestionShape, type RollupAnswerShape } from '../rollupEngine'
import fixture from './rollupEngine.fixture.json'

interface Scenario {
  name: string
  rollupId: number
  answers: Record<string, string>
  visibility: Record<string, boolean>
  expectedAnswer: 'yes' | 'no' | 'na'
  expectedVisibleMembers: number[]
  runTwice?: boolean
}

const questions: RollupQuestionShape[] = (fixture.questions as unknown) as RollupQuestionShape[]
const scenarios: Scenario[] = (fixture.scenarios as unknown) as Scenario[]

function toAnswers(record: Record<string, string>): Record<number, RollupAnswerShape> {
  const out: Record<number, RollupAnswerShape> = {}
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

describe('rollupEngine (backend)', () => {
  scenarios.forEach((s) => {
    it(s.name, () => {
      const rawAnswers = toAnswers(s.answers)
      const visibility = toVisibility(s.visibility)

      const first = deriveRollupAnswers(questions, rawAnswers, visibility)
      expect(first.answers[s.rollupId]?.answer).toBe(s.expectedAnswer)
      const note = first.notes.find((n) => n.questionId === s.rollupId)
      expect(note).toBeDefined()
      expect(note!.derivedAnswer).toBe(s.expectedAnswer)
      expect(note!.visibleMemberIds).toEqual(s.expectedVisibleMembers)

      if (s.runTwice) {
        const second = deriveRollupAnswers(questions, first.answers, visibility)
        expect(second.answers[s.rollupId]?.answer).toBe(s.expectedAnswer)
      }
    })
  })

  it('leaves DETAIL questions untouched and only writes ROLLUP answers', () => {
    const rawAnswers = toAnswers({ '101': 'yes', '102': 'no', '103': 'yes', '104': 'yes' })
    const visibility = toVisibility({ '101': true, '102': true, '103': true, '104': true })
    const before = JSON.stringify(rawAnswers)
    const result = deriveRollupAnswers(questions, rawAnswers, visibility)
    expect(JSON.stringify(rawAnswers)).toBe(before) // input not mutated
    // detail answers preserved exactly:
    expect(result.answers[101].answer).toBe('yes')
    expect(result.answers[102].answer).toBe('no')
    expect(result.answers[103].answer).toBe('yes')
    expect(result.answers[104].answer).toBe('yes')
    // rollup written:
    expect(result.answers[100].answer).toBe('no')
  })

  it('forms with no ROLLUP questions are a no-op', () => {
    const detailOnly: RollupQuestionShape[] = questions.filter((q) => q.role !== 'ROLLUP')
    const rawAnswers = toAnswers({ '101': 'yes', '102': 'no' })
    const result = deriveRollupAnswers(detailOnly, rawAnswers, {})
    expect(result.notes).toEqual([])
    expect(result.answers).toEqual(rawAnswers)
  })
})
