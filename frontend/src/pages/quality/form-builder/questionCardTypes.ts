import type { RadioOption } from '@/types/form.types'

export interface AllQuestionRef {
  id: number
  text: string
  type: string
  catName: string
  scaleMin: number
  scaleMax: number
  naAllowed: boolean
  radioOptions: RadioOption[]
}
