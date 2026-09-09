import { describe, expect, it } from 'vitest'
import { APPLICABLE_SQL, EARNED_EXPR, IS_NA_SQL, POSSIBLE_EXPR, QUESTION_VISIBLE_SQL } from '../qcScoreExprs'

describe('qcScoreExprs', () => {
  it('treats both na and n/a as allowed N/A', () => {
    expect(IS_NA_SQL).toContain("'n/a'")
    expect(IS_NA_SQL).toContain("'na'")
    expect(IS_NA_SQL).toContain('fq.is_na_allowed')
  })

  it('evaluates form_question_conditions for visibility', () => {
    expect(QUESTION_VISIBLE_SQL).toContain('form_question_conditions')
    expect(QUESTION_VISIBLE_SQL).toContain('EQUALS')
    expect(QUESTION_VISIBLE_SQL).toContain('NOT_EQUALS')
    expect(QUESTION_VISIBLE_SQL).toContain('EXISTS')
    expect(QUESTION_VISIBLE_SQL).toContain('NOT_EXISTS')
  })

  it('wraps earned and possible so inapplicable answers contribute 0', () => {
    expect(APPLICABLE_SQL).toContain('NOT')
    expect(EARNED_EXPR).toContain('THEN 0')
    expect(POSSIBLE_EXPR).toContain('THEN 0')
    expect(EARNED_EXPR).toContain(APPLICABLE_SQL)
    expect(POSSIBLE_EXPR).toContain(APPLICABLE_SQL)
  })
})
