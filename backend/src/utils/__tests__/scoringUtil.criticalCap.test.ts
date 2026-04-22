/**
 * Critical-fail cap rule unit tests for backend/src/utils/scoringUtil.ts.
 *
 * Pinpoints three behaviors of `calculateFormScore`:
 *   1. cap fires    — at least one critical NO + raw above cap → final = cap, score_capped = true
 *   2. cap inert    — critical NO present but raw <= cap → score_capped = false, final = raw
 *   3. count accuracy — every critical-question NO answer increments critical_fail_count
 *
 * Prisma is mocked so the suite runs without DB access. The mock supplies a
 * minimal form/category/question shape; conditions and radio options are empty
 * because YES_NO is enough to exercise the cap rule.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  default: {
    form:                  { findUnique: vi.fn() },
    formCategory:          { findMany:   vi.fn() },
    formQuestion:          { findMany:   vi.fn() },
    radioOption:           { findMany:   vi.fn() },
    formQuestionCondition: { findMany:   vi.fn() },
  },
}))

import prisma from '../../config/prisma'
import { calculateFormScore } from '../scoringUtil'

const formMock      = prisma.form          as unknown as { findUnique: ReturnType<typeof vi.fn> }
const categoryMock  = prisma.formCategory  as unknown as { findMany:   ReturnType<typeof vi.fn> }
const questionMock  = prisma.formQuestion  as unknown as { findMany:   ReturnType<typeof vi.fn> }
const radioMock     = prisma.radioOption   as unknown as { findMany:   ReturnType<typeof vi.fn> }
const conditionMock = prisma.formQuestionCondition as unknown as { findMany: ReturnType<typeof vi.fn> }

const FORM_ID = 999
const CATEGORY_ID = 1

function setupForm(opts: {
  cap?: number
  questions: Array<{
    id: number
    is_critical?: boolean
    yes_value?: number
    no_value?: number
  }>
}) {
  formMock.findUnique.mockResolvedValue({ critical_cap_percent: opts.cap ?? 79.0 })
  categoryMock.findMany.mockResolvedValue([
    { id: CATEGORY_ID, form_id: FORM_ID, category_name: 'General', weight: 1 },
  ])
  questionMock.findMany.mockResolvedValue(
    opts.questions.map(q => ({
      id: q.id,
      category_id: CATEGORY_ID,
      question_text: `Q${q.id}`,
      question_type: 'YES_NO',
      yes_value: q.yes_value ?? 10,
      no_value:  q.no_value  ?? 0,
      is_critical: !!q.is_critical,
      sort_order: q.id,
    })),
  )
  radioMock.findMany.mockResolvedValue([])
  conditionMock.findMany.mockResolvedValue([])
}

beforeEach(() => {
  formMock.findUnique.mockReset()
  categoryMock.findMany.mockReset()
  questionMock.findMany.mockReset()
  radioMock.findMany.mockReset()
  conditionMock.findMany.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('calculateFormScore — critical-fail cap rule', () => {
  it('caps the final score when a critical question is missed and raw > cap', async () => {
    // 9 yes + 1 critical no → raw = 90% which is above the 79% cap
    setupForm({
      cap: 79,
      questions: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        is_critical: i === 0,
      })),
    })
    const answers = [
      { question_id: 1, answer: 'no' },
      ...Array.from({ length: 9 }, (_, i) => ({
        question_id: i + 2,
        answer: 'yes',
      })),
    ]

    const result = await calculateFormScore(null, FORM_ID, answers)

    expect(result.raw_score).toBeCloseTo(90, 2)
    expect(result.total_score).toBe(79)
    expect(result.score_capped).toBe(true)
    expect(result.critical_fail_count).toBe(1)
    expect(result.critical_cap_percent).toBe(79)
  })

  it('does NOT cap when raw score is at or below the cap (cap is a ceiling, not a floor)', async () => {
    // 1 critical NO + 4 non-critical NOs + 5 YES → raw = 50% which is below the 79% cap
    setupForm({
      cap: 79,
      questions: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        is_critical: i === 0,
      })),
    })
    const answers = [
      { question_id: 1, answer: 'no' },
      { question_id: 2, answer: 'no' },
      { question_id: 3, answer: 'no' },
      { question_id: 4, answer: 'no' },
      { question_id: 5, answer: 'no' },
      { question_id: 6, answer: 'yes' },
      { question_id: 7, answer: 'yes' },
      { question_id: 8, answer: 'yes' },
      { question_id: 9, answer: 'yes' },
      { question_id: 10, answer: 'yes' },
    ]

    const result = await calculateFormScore(null, FORM_ID, answers)

    expect(result.raw_score).toBeCloseTo(50, 2)
    expect(result.total_score).toBeCloseTo(50, 2)
    expect(result.score_capped).toBe(false)
    expect(result.critical_fail_count).toBe(1)
  })

  it('does NOT cap when no critical questions were missed, even with non-critical NOs', async () => {
    // Critical Q1 = YES, several non-critical NOs → no cap regardless of raw
    setupForm({
      cap: 79,
      questions: Array.from({ length: 4 }, (_, i) => ({
        id: i + 1,
        is_critical: i === 0,
      })),
    })
    const answers = [
      { question_id: 1, answer: 'yes' },
      { question_id: 2, answer: 'no' },
      { question_id: 3, answer: 'yes' },
      { question_id: 4, answer: 'yes' },
    ]

    const result = await calculateFormScore(null, FORM_ID, answers)

    expect(result.raw_score).toBeCloseTo(75, 2)
    expect(result.total_score).toBeCloseTo(75, 2)
    expect(result.score_capped).toBe(false)
    expect(result.critical_fail_count).toBe(0)
  })

  it('counts every critical NO answer (multi-critical accuracy)', async () => {
    setupForm({
      cap: 50,
      questions: [
        { id: 1, is_critical: true },
        { id: 2, is_critical: true },
        { id: 3, is_critical: true },
        { id: 4, is_critical: false },
      ],
    })
    const answers = [
      { question_id: 1, answer: 'no' },
      { question_id: 2, answer: 'no' },
      { question_id: 3, answer: 'yes' },
      { question_id: 4, answer: 'yes' },
    ]

    const result = await calculateFormScore(null, FORM_ID, answers)

    expect(result.critical_fail_count).toBe(2)
    // raw = 50%, equal to the cap, so not capped (rule requires raw > cap)
    expect(result.raw_score).toBeCloseTo(50, 2)
    expect(result.score_capped).toBe(false)
    expect(result.total_score).toBeCloseTo(50, 2)
  })
})
