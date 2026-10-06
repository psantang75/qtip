/**
 * Agent Visible = No questions are labelled "Hidden from agent" for reviewers
 * and still never rendered for CSRs (role 3).
 */
import { describe, expect, it } from 'vitest'
import { prepareQuestionForRender, prepareFormForRender } from '../formRenderPrep'
import type { Form, FormQuestion } from '../../../types/form.types'

const question = (id: number, visible_to_csr?: boolean): FormQuestion => ({
  id,
  category_id: 1,
  question_text: `Q${id}`,
  question_type: 'YES_NO',
  weight: 1,
  visible_to_csr,
}) as FormQuestion

const form = (): Form => ({
  id: 1,
  form_name: 'Sales Interaction QA',
  interaction_type: 'CALL',
  categories: [{
    id: 1,
    category_name: 'Coaching',
    weight: 1,
    questions: [question(10, true), question(11, false)],
  }],
}) as unknown as Form

describe('prepareQuestionForRender hiddenFromAgent', () => {
  it('flags Agent Visible = No questions', () => {
    expect(prepareQuestionForRender(question(1, false)).hiddenFromAgent).toBe(true)
  })

  it('does not flag visible or unset questions', () => {
    expect(prepareQuestionForRender(question(1, true)).hiddenFromAgent).toBe(false)
    expect(prepareQuestionForRender(question(1)).hiddenFromAgent).toBe(false)
  })
})

describe('prepareFormForRender', () => {
  const visibility = { 10: true, 11: true }

  it('keeps hidden questions, flagged, for reviewers', () => {
    const [cat] = prepareFormForRender(form(), {}, visibility, undefined, undefined, 2).categories
    expect(cat.questions.map(q => [q.id, q.hiddenFromAgent])).toEqual([[10, false], [11, true]])
  })

  it('still drops hidden questions for CSRs', () => {
    const [cat] = prepareFormForRender(form(), {}, visibility, undefined, undefined, 3).categories
    expect(cat.questions.map(q => q.id)).toEqual([10])
  })
})
