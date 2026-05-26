import type { FormQuestionRole, RadioOption } from '@/types/form.types'

export interface AllQuestionRef {
  id: number
  text: string
  type: string
  catName: string
  scaleMin: number
  scaleMax: number
  naAllowed: boolean
  radioOptions: RadioOption[]
  /**
   * Question's declared role (DETAIL default, or ROLLUP for category
   * summary questions). Surfaced here so the QuestionEditPanel can:
   *   - exclude other ROLLUPs from a roll-up's member picker (no nested
   *     roll-ups in V1)
   *   - render the small "Roll-up" badge next to the question text
   */
  role: FormQuestionRole
}
