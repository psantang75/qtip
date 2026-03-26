import { cn } from '@/lib/utils'
import { CheckCircle2 } from 'lucide-react'
import type { Form, FormMetadataField, FormCategory } from '@/types/form.types'

export type Step = 'metadata' | 'categories' | 'questions' | 'preview'
export const STEPS: Step[] = ['metadata', 'categories', 'questions', 'preview']
export const STEP_LABELS: Record<Step, string> = {
  metadata: '1. Details', categories: '2. Categories', questions: '3. Questions', preview: '4. Preview & Save',
}

export function freshForm(): Form {
  const defaultMetadata: FormMetadataField[] = [
    { field_name: 'Reviewer Name', field_type: 'AUTO',     is_required: true,  interaction_type: 'CALL', sort_order: 0 },
    { field_name: 'Review Date',   field_type: 'AUTO',     is_required: true,  interaction_type: 'CALL', sort_order: 1 },
    { field_name: 'CSR',           field_type: 'DROPDOWN', is_required: true,  interaction_type: 'CALL', sort_order: 2 },
    { field_name: 'Spacer-1',      field_type: 'SPACER',   is_required: false, interaction_type: 'CALL', sort_order: 3 },
    { field_name: 'Customer ID',   field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 4 },
    { field_name: 'Customer Name', field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 5 },
    { field_name: 'Ticket Number', field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 6 },
    { field_name: 'Spacer-2',      field_type: 'SPACER',   is_required: false, interaction_type: 'CALL', sort_order: 7 },
    { field_name: 'Call Conversation ID', field_type: 'TEXT', is_required: true, interaction_type: 'CALL', sort_order: 8 },
    { field_name: 'Call Date',     field_type: 'DATE',     is_required: true,  interaction_type: 'CALL', sort_order: 9 },
  ]
  return { form_name: '', interaction_type: 'CALL', is_active: true, version: 1, categories: [], metadata_fields: defaultMetadata }
}

export function totalCategoryWeight(categories: FormCategory[]): number {
  return categories.reduce((s, c) => s + (c.weight || 0), 0)
}

export function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => {
        const idx = STEPS.indexOf(current)
        const done = i < idx; const active = s === current
        return (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              active ? 'bg-primary text-white' : done ? 'bg-primary/20 text-primary' : 'bg-slate-100 text-slate-400')}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[s].split('. ')[1]}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn('flex-1 h-px', i < idx ? 'bg-primary/40' : 'bg-slate-200')} />}
          </div>
        )
      })}
    </div>
  )
}
