import type { CoachingType, CoachingSourceType } from '@/services/trainingService'

export interface CoachingFormState {
  csr_id: number
  session_date: string
  coaching_type: CoachingType | ''
  source_type: CoachingSourceType | ''
  notes: string
  topic_ids: number[]
  required_action: string
  kb_mode: 'library' | 'custom'
  kb_resource_id: number
  kb_url: string
  kb_label: string
  quiz_required: boolean
  quiz_id: number
  require_acknowledgment: boolean
  require_action_plan: boolean
  due_date: string
  follow_up_required: boolean
  follow_up_date: string
  attachment_file: File | null
}

export type CoachingFormErrors = Partial<Record<keyof CoachingFormState | 'root', string>>

export function emptyForm(): CoachingFormState {
  return {
    csr_id: 0,
    session_date: new Date().toISOString().slice(0, 16),
    coaching_type: '',
    source_type: '',
    notes: '',
    topic_ids: [],
    required_action: '',
    kb_mode: 'library',
    kb_resource_id: 0,
    kb_url: '',
    kb_label: '',
    quiz_required: false,
    quiz_id: 0,
    require_acknowledgment: true,
    require_action_plan: true,
    due_date: '',
    follow_up_required: false,
    follow_up_date: '',
    attachment_file: null,
  }
}
