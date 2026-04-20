import type { WriteUpType, WriteUpExampleSource } from '@/services/writeupService'

export type { WriteUpType, WriteUpExampleSource }

export interface ExampleInput {
  id?: number
  example_date: string
  description: string
  source: WriteUpExampleSource
  qa_submission_id?: number | null
  qa_question_id?: number | null
  sort_order: number
}

export interface ViolationInput {
  id?: number
  policy_violated: string
  reference_material: string
  sort_order: number
  examples: ExampleInput[]
}

export interface IncidentInput {
  id?: number
  description: string
  sort_order: number
  violations: ViolationInput[]
}

export interface PriorDisciplineRef {
  reference_type: 'write_up' | 'coaching_session'
  reference_id: number
  label: string
  // Optional display metadata — populated when added from modals
  date?: string
  subtype?: string    // document_type label (write-up) or coaching_purpose label (coaching)
  detail?: string[]   // policies_violated (write-up) or topic_names (coaching)
  notes?: string      // incident_descriptions (write-up) or session notes (coaching)
  status?: string
}

export interface SavedAttachment {
  id: number
  filename: string
  file_size?: number | null
  mime_type?: string | null
  attachment_type: string
}

export interface WriteUpFormState {
  csr_id: number
  document_type: WriteUpType | ''
  manager_id: number
  hr_witness_id: number
  meeting_date: string
  corrective_action: string
  correction_timeline: string
  consequence: string
  linked_coaching_id: number | null
  linked_coaching_label: string
  incidents: IncidentInput[]
  prior_discipline: PriorDisciplineRef[]
  meeting_notes: string
  attachment_files: File[]
  existing_attachments: SavedAttachment[]
  internal_notes: string
  behavior_flag_ids: number[]
  root_cause_ids: number[]
  support_needed_ids: number[]
}

export function emptyForm(): WriteUpFormState {
  return {
    csr_id: 0,
    document_type: '',
    manager_id: 0,
    hr_witness_id: 0,
    meeting_date: '',
    corrective_action: '',
    correction_timeline: '',
    consequence: '',
    linked_coaching_id: null,
    linked_coaching_label: '',
    incidents: [],
    prior_discipline: [],
    meeting_notes: '',
    attachment_files: [],
    existing_attachments: [],
    internal_notes: '',
    behavior_flag_ids: [],
    root_cause_ids: [],
    support_needed_ids: [],
  }
}

export function newIncident(order: number): IncidentInput {
  return { description: '', sort_order: order, violations: [newViolation(0)] }
}

export function newViolation(order: number): ViolationInput {
  return { policy_violated: '', reference_material: '', sort_order: order, examples: [] }
}

export function newExample(source: WriteUpExampleSource, order: number): ExampleInput {
  return { example_date: '', description: '', source, sort_order: order }
}
