import type { CoachingPurpose, CoachingFormat, CoachingSourceType } from '@/services/trainingService'

export interface CoachingFormState {
  csr_id: number
  coach_id: number
  session_date: string
  coaching_purpose: CoachingPurpose | ''
  coaching_format: CoachingFormat | ''
  source_type: CoachingSourceType | ''
  notes: string
  topic_ids: number[]
  required_action: string
  kb_resource_ids: number[]
  quiz_ids: number[]
  require_acknowledgment: boolean
  require_action_plan: boolean
  due_date: string
  follow_up_required: boolean
  follow_up_date: string
  follow_up_notes: string
  internal_notes: string
  behavior_flags: string[]
  attachment_file: File | null
}

export type CoachingFormErrors = Partial<Record<keyof CoachingFormState | 'root', string>>

export function emptyForm(): CoachingFormState {
  return {
    csr_id: 0,
    coach_id: 0,
    session_date: new Date().toISOString().slice(0, 16),
    coaching_purpose: '',
    coaching_format: '',
    source_type: '',
    notes: '',
    topic_ids: [],
    required_action: '',
    kb_resource_ids: [],
    quiz_ids: [],
    require_acknowledgment: false,
    require_action_plan: false,
    due_date: '',
    follow_up_required: false,
    follow_up_date: '',
    follow_up_notes: '',
    internal_notes: '',
    behavior_flags: [],
    attachment_file: null,
  }
}
