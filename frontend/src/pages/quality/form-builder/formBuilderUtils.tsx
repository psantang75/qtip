import { cn } from '@/lib/utils'
import { CheckCircle2 } from 'lucide-react'
import type { Form, FormMetadataField, FormCategory, RadioOption } from '@/types/form.types'
import { normalizeStandardMetadataOrder, isAgentMetadataField } from '@/utils/formMetadataOrder'

export type Step = 'metadata' | 'categories' | 'questions' | 'preview'
export const STEPS: Step[] = ['metadata', 'categories', 'questions', 'preview']
// Calibration is a sibling tab outside the linear save wizard; it only
// shows after the form has been saved AND ai_enabled is on. Keeping it
// out of STEPS preserves the existing Next/Back validation flow.
export const STEP_LABELS: Record<Step, string> = {
  metadata: '1. Details', categories: '2. Categories', questions: '3. Questions', preview: '4. Preview & Save',
}

/**
 * Puts a form's metadata fields into the canonical order. Nothing more: a form
 * shows exactly the fields it defines.
 *
 * This used to also rewrite a `SPACER` in the first four slots into a required
 * "Interaction Date" (DATE), as a bridge for forms predating the current
 * default template. It was removed because the invented field was mandatory yet
 * saved against a row the database still classified as `SPACER`, which every
 * read path filters out — so reviewers were blocked until they filled in a date
 * that was then discarded. A form that wants an Interaction Date should declare
 * one in the form builder.
 */
export function normalizeFormMetadata(form: Form): Form {
  const fields = form.metadata_fields ? [...form.metadata_fields] : []
  return { ...form, metadata_fields: normalizeStandardMetadataOrder(fields) }
}

export function freshForm(): Form {
  const defaultMetadata: FormMetadataField[] = [
    { field_name: 'Reviewer Name', field_type: 'AUTO',     is_required: true,  interaction_type: 'CALL', sort_order: 0 },
    { field_name: 'Review Date',   field_type: 'AUTO',     is_required: true,  interaction_type: 'CALL', sort_order: 1 },
    // Canonical tag is 'CSR' (joined against the users table everywhere on the
    // backend). The UI relabels it "Agent" via displayFieldName — do NOT store
    // 'Agent' here or the CSR-keyed joins (list, detail, register) miss it.
    { field_name: 'CSR',           field_type: 'DROPDOWN', is_required: true,  interaction_type: 'CALL', sort_order: 2 },
    { field_name: 'Interaction Date', field_type: 'DATE',   is_required: true,  interaction_type: 'CALL', sort_order: 3 },
    { field_name: 'Customer ID',   field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 4 },
    { field_name: 'Customer Name', field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 5 },
    { field_name: 'Ticket Number', field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 6 },
    { field_name: 'Spacer-2',      field_type: 'SPACER',   is_required: false, interaction_type: 'CALL', sort_order: 7 },
    { field_name: 'Call Conversation ID', field_type: 'TEXT', is_required: true, interaction_type: 'CALL', sort_order: 8 },
    { field_name: 'Call Date',     field_type: 'DATE',     is_required: true,  interaction_type: 'CALL', sort_order: 9 },
  ]
  return { form_name: '', interaction_type: 'CALL', is_active: true, version: 1, critical_cap_percent: 79, ai_enabled: false, ai_review_guidance: null, ai_submit_as_draft: false, ai_sample_review_pct: 10, ai_sample_low_score_always: true, categories: [], metadata_fields: defaultMetadata }
}

export function totalCategoryWeight(categories: FormCategory[]): number {
  return categories.reduce((s, c) => s + (c.weight || 0), 0)
}

/** Next unused string id for a new radio / multi-select option (prefers 1, 2, 3…; skips values already in use). */
export function nextIncrementalOptionValue(options: RadioOption[]): string {
  const used = new Set(
    options.map(o => String(o.option_value ?? '').trim()).filter(v => v.length > 0),
  )
  let maxNum = 0
  for (const o of options) {
    const n = Number.parseInt(String(o.option_value ?? '').trim(), 10)
    if (Number.isFinite(n) && n > maxNum) maxNum = n
  }
  let candidate = maxNum
  for (;;) {
    candidate += 1
    const s = String(candidate)
    if (!used.has(s)) return s
  }
}

/** Fill blank `option_value` on each option; preserves non-empty values (submissions + conditions). */
export function ensureRadioOptionValues(options: RadioOption[]): RadioOption[] {
  const used = new Set(
    options.map(o => String(o.option_value ?? '').trim()).filter(v => v.length > 0),
  )
  let maxNum = 0
  for (const o of options) {
    const n = Number.parseInt(String(o.option_value ?? '').trim(), 10)
    if (Number.isFinite(n) && n > maxNum) maxNum = n
  }
  let candidate = maxNum
  return options.map(o => {
    const v = String(o.option_value ?? '').trim()
    if (v) return o
    for (;;) {
      candidate += 1
      const s = String(candidate)
      if (!used.has(s)) {
        used.add(s)
        return { ...o, option_value: s }
      }
    }
  })
}

export function ensureFormRadioOptionValues(form: Form): Form {
  return {
    ...form,
    categories: form.categories.map(c => ({
      ...c,
      questions: (c.questions || []).map(q => {
        const ro = q.radio_options
        if (!ro?.length) return q
        return { ...q, radio_options: ensureRadioOptionValues(ro) }
      }),
    })),
  }
}

/** Radio / multi-select options no longer support per-option free text in the builder; always persist false. */
export function stripRadioFreeTextFlags(form: Form): Form {
  return {
    ...form,
    categories: form.categories.map(c => ({
      ...c,
      questions: (c.questions || []).map(q => ({
        ...q,
        radio_options: (q.radio_options || []).map(o => ({ ...o, has_free_text: false })),
      })),
    })),
  }
}

/** Final normalization before create/update API (stable option ids + no free-text flags + metadata order). */
export function normalizeFormBuilderPayload(form: Form): Form {
  const stripped = stripRadioFreeTextFlags(ensureFormRadioOptionValues(form))
  // The agent picker is stored under the canonical 'CSR' tag (the UI shows it
  // as "Agent"). Whatever the admin typed, force it back to 'CSR' so every
  // CSR-keyed backend join (submissions list, review detail, unlock register)
  // resolves the agent from the users table.
  const canonicalized = (stripped.metadata_fields || []).map(f =>
    isAgentMetadataField(f) ? { ...f, field_name: 'CSR' } : f,
  )
  return {
    ...stripped,
    metadata_fields: normalizeStandardMetadataOrder(canonicalized),
  }
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
