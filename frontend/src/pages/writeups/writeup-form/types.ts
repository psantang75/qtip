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
  incident_date: string
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
  subtype?: string   // document_type label (write-up) or coaching_purpose label (coaching)
  detail?: string    // policies_violated or topic_names
  status?: string
}

export interface WriteUpFormState {
  csr_id: number
  document_type: WriteUpType | ''
  manager_id: number
  hr_witness_id: number
  meeting_date: string
  corrective_action: string
  correction_timeline: string
  checkin_date: string
  consequence: string
  linked_coaching_id: number | null
  linked_coaching_label: string
  incidents: IncidentInput[]
  prior_discipline: PriorDisciplineRef[]
  meeting_notes: string
  attachment_files: File[]
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
    checkin_date: '',
    consequence: '',
    linked_coaching_id: null,
    linked_coaching_label: '',
    incidents: [],
    prior_discipline: [],
    meeting_notes: '',
    attachment_files: [],
  }
}

export function newIncident(order: number): IncidentInput {
  return { incident_date: '', description: '', sort_order: order, violations: [newViolation(0)] }
}

export function newViolation(order: number): ViolationInput {
  return { policy_violated: '', reference_material: '', sort_order: order, examples: [] }
}

export function newExample(source: WriteUpExampleSource, order: number): ExampleInput {
  return { example_date: '', description: '', source, sort_order: order }
}
