import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Field, ListItemMultiSelect } from '@/pages/training/coaching-form/CoachingFormSections'
import type { ListItem } from '@/services/listService'
import type { WriteUpFormState } from './types'

interface Props {
  form: WriteUpFormState
  flagItems: ListItem[]
  rootCauseItems?: ListItem[]
  supportNeededItems?: ListItem[]
  update: <K extends keyof WriteUpFormState>(k: K, v: WriteUpFormState[K]) => void
}

/**
 * Write-up form Internal Notes section. Mirrors the coaching InternalNotesSection
 * but binds to WriteUpFormState. Private — management only, not visible to agents.
 */
export function InternalNotesSection({ form, flagItems, rootCauseItems = [], supportNeededItems = [], update }: Props) {
  const toggleList = (field: 'behavior_flag_ids' | 'root_cause_ids' | 'support_needed_ids', id: number) => {
    const current = form[field] ?? []
    update(field, current.includes(id) ? current.filter(x => x !== id) : [...current, id])
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-800">Internal Notes</h3>
        <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
          Private — Not visible to Agent
        </span>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4">
            <Field label="Root Cause">
              <ListItemMultiSelect
                items={rootCauseItems}
                selectedIds={form.root_cause_ids ?? []}
                onToggle={id => toggleList('root_cause_ids', id)}
                placeholder="Select root causes…"
                emptyMessage="No root causes configured"
              />
            </Field>
            <Field label="Support Needed">
              <ListItemMultiSelect
                items={supportNeededItems}
                selectedIds={form.support_needed_ids ?? []}
                onToggle={id => toggleList('support_needed_ids', id)}
                placeholder="Select support needed…"
                emptyMessage="No support options configured"
              />
            </Field>
          </div>
          <Field label="Behavior Flags">
            <ListItemMultiSelect
              items={flagItems}
              selectedIds={form.behavior_flag_ids ?? []}
              onToggle={id => toggleList('behavior_flag_ids', id)}
              placeholder="Select behavior flags…"
              emptyMessage="No behavior flags configured"
            />
          </Field>
        </div>
        <Field label="Internal Notes">
          <RichTextEditor
            value={form.internal_notes}
            placeholder="Context, observations, concerns…"
            onChange={html => update('internal_notes', html)}
          />
        </Field>
      </div>
    </div>
  )
}

export default InternalNotesSection
