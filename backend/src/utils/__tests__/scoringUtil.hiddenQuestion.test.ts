/**
 * Visibility-rule regression tests for backend/src/utils/scoringUtil.ts.
 *
 * Pins the contract relied on by the new roll-up engine and by the
 * form-builder gating UX: a question hidden by `FormQuestionCondition` is
 * EXCLUDED from scoring entirely (no impact on numerator OR denominator) -
 * it is not scored as zero. Both engines must obey this so that:
 *
 *   - Gated action questions cost the agent nothing when their gate is NO.
 *   - Roll-up questions can safely ignore hidden members.
 *
 * If anyone ever changes scoringUtil to score-as-zero instead of skipping,
 * these tests are designed to fail loudly.
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

const FORM_ID = 9001
const CATEGORY_ID = 1

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

/**
 * Builds a tiny "gate + action" form:
 *   Q1 = "Did the situation arise?" (gate, always visible, YES_NO)
 *   Q2 = "Always-required check" (always visible, YES_NO)
 *   Q3 = "Was the action done correctly?" (conditional on Q1 = YES, YES_NO)
 */
function setupGateAndActionForm(opts: { q3IsCritical?: boolean } = {}) {
  formMock.findUnique.mockResolvedValue({ critical_cap_percent: 79.0 })
  categoryMock.findMany.mockResolvedValue([
    { id: CATEGORY_ID, form_id: FORM_ID, category_name: 'General', weight: 1 },
  ])
  questionMock.findMany.mockResolvedValue([
    { id: 1, category_id: CATEGORY_ID, question_text: 'Gate',   question_type: 'YES_NO', yes_value: 10, no_value: 0, is_critical: false, sort_order: 1 },
    { id: 2, category_id: CATEGORY_ID, question_text: 'Always', question_type: 'YES_NO', yes_value: 10, no_value: 0, is_critical: false, sort_order: 2 },
    { id: 3, category_id: CATEGORY_ID, question_text: 'Action', question_type: 'YES_NO', yes_value: 10, no_value: 0, is_critical: !!opts.q3IsCritical, sort_order: 3 },
  ])
  radioMock.findMany.mockResolvedValue([])
  conditionMock.findMany.mockResolvedValue([
    {
      id: 100,
      question_id: 3,
      target_question_id: 1,
      condition_type: 'EQUALS',
      target_value: 'YES',
      logical_operator: 'AND',
      group_id: 0,
    },
  ])
}

describe('calculateFormScore - hidden question is excluded, not scored-as-zero', () => {
  it('gate=YES leaves the action visible and scored normally', async () => {
    setupGateAndActionForm()
    const result = await calculateFormScore(null, FORM_ID, [
      { question_id: 1, answer: 'yes' },
      { question_id: 2, answer: 'yes' },
      { question_id: 3, answer: 'yes' },
    ])
    expect(result.raw_score).toBeCloseTo(100, 2)
    expect(result.total_score).toBeCloseTo(100, 2)
    expect(result.critical_fail_count).toBe(0)
  })

  it('gate=NO hides the action; remaining 2 questions score 50%, NOT 33%', async () => {
    // If the action were scored-as-zero, raw would be 1/3 = 33.33%.
    // With proper exclusion it is 1/2 = 50%. This is the central invariant.
    setupGateAndActionForm()
    const result = await calculateFormScore(null, FORM_ID, [
      { question_id: 1, answer: 'no'  },
      { question_id: 2, answer: 'yes' },
      { question_id: 3, answer: 'yes' },
    ])
    expect(result.raw_score).toBeCloseTo(50, 2)
    expect(result.total_score).toBeCloseTo(50, 2)
  })

  it('gate=NO hides the action even when the action has a NO answer (NO is ignored)', async () => {
    setupGateAndActionForm()
    const result = await calculateFormScore(null, FORM_ID, [
      { question_id: 1, answer: 'no'  },
      { question_id: 2, answer: 'yes' },
      { question_id: 3, answer: 'no'  },
    ])
    expect(result.raw_score).toBeCloseTo(50, 2)
    expect(result.total_score).toBeCloseTo(50, 2)
  })

  it('gate=NO suppresses a hidden critical NO: critical_fail_count stays 0, no cap fires', async () => {
    setupGateAndActionForm({ q3IsCritical: true })
    const result = await calculateFormScore(null, FORM_ID, [
      { question_id: 1, answer: 'no'  },
      { question_id: 2, answer: 'yes' },
      { question_id: 3, answer: 'no'  },
    ])
    expect(result.critical_fail_count).toBe(0)
    expect(result.score_capped).toBe(false)
    expect(result.raw_score).toBeCloseTo(50, 2)
  })

  it('gate=NO with no answer recorded for the hidden action still excludes it cleanly', async () => {
    setupGateAndActionForm()
    const result = await calculateFormScore(null, FORM_ID, [
      { question_id: 1, answer: 'no'  },
      { question_id: 2, answer: 'yes' },
    ])
    expect(result.raw_score).toBeCloseTo(50, 2)
    expect(result.total_score).toBeCloseTo(50, 2)
  })
})
