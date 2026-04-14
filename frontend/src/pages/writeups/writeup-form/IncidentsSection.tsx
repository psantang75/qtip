import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { FormSection, Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { QaSearchModal } from './QaSearchModal'
import listService from '@/services/listService'
import {
  newIncident, newViolation, newExample,
  type WriteUpFormState, type IncidentInput, type ViolationInput, type ExampleInput,
} from './types'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

type ModalTarget = { incIdx: number }

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: ExampleInput['source'] }) {
  const map = {
    MANUAL:           { label: 'Manual',   cls: 'bg-slate-100 text-slate-600' },
    QA_IMPORT:        { label: 'QA',       cls: 'bg-blue-50 text-blue-700' },
    COACHING_IMPORT:  { label: 'Coaching', cls: 'bg-green-50 text-green-700' },
  }
  const { label, cls } = map[source]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ── Example row ───────────────────────────────────────────────────────────────

function ExampleRow({ example, onChange, onRemove }: {
  example: ExampleInput
  onChange: (partial: Partial<ExampleInput>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex gap-2 items-start pb-2 pt-0 border-b border-slate-50 last:border-0">
      <div className="flex-1 grid grid-cols-[160px_1fr] gap-2 items-start">
        <div className="space-y-1">
          <Input
            type="date"
            className="h-8 text-[12px]"
            value={example.example_date}
            onChange={e => onChange({ example_date: e.target.value })}
          />
          <SourceBadge source={example.source} />
        </div>
        <RichTextEditor
          className="text-[12px] min-h-[56px]"
          placeholder="Describe the example…"
          value={example.description}
          onChange={html => onChange({ description: html })}
        />
      </div>
      <Button type="button" variant="ghost" size="sm"
        className="mt-1 h-6 w-6 p-0 text-slate-300 hover:text-red-500 hover:bg-transparent shrink-0"
        onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ── Violation block ───────────────────────────────────────────────────────────

function ViolationPolicyFields({ violation, onChange, onRemove }: {
  violation: ViolationInput
  onChange: (partial: Partial<ViolationInput>) => void
  onRemove: () => void
}) {
  const { data: policyItems = [] } = useQuery({
    queryKey: ['list-items', 'writeup_policy'],
    queryFn:  () => listService.getItems('writeup_policy'),
    staleTime: 5 * 60_000,
  })
  const { data: referenceItems = [] } = useQuery({
    queryKey: ['list-items', 'writeup_reference'],
    queryFn:  () => listService.getItems('writeup_reference'),
    staleTime: 5 * 60_000,
  })

  const activePolicy    = policyItems.filter(i => i.is_active)
  const activeReference = referenceItems.filter(i => i.is_active)

  const policyNotInList = violation.policy_violated &&
    !activePolicy.some(i => i.label === violation.policy_violated)
  const refNotInList = violation.reference_material &&
    !activeReference.some(i => i.label === violation.reference_material)

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/30">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Policy Violated" required>
          <Select
            value={violation.policy_violated || ''}
            onValueChange={v => onChange({ policy_violated: v })}
          >
            <SelectTrigger className="h-8 text-[13px]">
              <SelectValue placeholder="Select policy…" />
            </SelectTrigger>
            <SelectContent>
              {policyNotInList && (
                <SelectItem value={violation.policy_violated}>{violation.policy_violated}</SelectItem>
              )}
              {activePolicy.map(i => (
                <SelectItem key={i.id} value={i.label}>{i.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Reference Material">
          <Select
            value={violation.reference_material || ''}
            onValueChange={v => onChange({ reference_material: v === '__clear__' ? '' : v })}
          >
            <SelectTrigger className="h-8 text-[13px]">
              <SelectValue placeholder="Select reference…" />
            </SelectTrigger>
            <SelectContent>
              {violation.reference_material && (
                <SelectItem value="__clear__" className="text-slate-400 italic">— Clear —</SelectItem>
              )}
              {refNotInList && (
                <SelectItem value={violation.reference_material}>{violation.reference_material}</SelectItem>
              )}
              {activeReference.map(i => (
                <SelectItem key={i.id} value={i.label}>{i.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end mt-2">
        <Button type="button" variant="ghost" size="sm"
          className="h-6 text-[12px] text-red-400 hover:text-red-600 hover:bg-red-50"
          onClick={onRemove}>
          <Trash2 className="h-3 w-3 mr-1" /> Remove Violation
        </Button>
      </div>
    </div>
  )
}

// ── Incident block ────────────────────────────────────────────────────────────

function IncidentBlock({ incident, incIdx, onChange, onRemove, onOpenQa }: {
  incident: IncidentInput
  incIdx: number
  onChange: (partial: Partial<IncidentInput>) => void
  onRemove: () => void
  onOpenQa: () => void
}) {
  const updateViolation = (vIdx: number, partial: Partial<ViolationInput>) =>
    onChange({ violations: incident.violations.map((v, i) => i === vIdx ? { ...v, ...partial } : v) })

  const removeViolation = (vIdx: number) =>
    onChange({ violations: incident.violations.filter((_, i) => i !== vIdx) })

  const addViolation = () =>
    onChange({ violations: [...incident.violations, newViolation(incident.violations.length)] })

  // Flatten all examples across violations into a single list with origin tracking
  const allExamples = incident.violations.flatMap((v, vIdx) =>
    v.examples.map((ex, eIdx) => ({ ex, vIdx, eIdx }))
  )

  const updateExample = (vIdx: number, eIdx: number, partial: Partial<ExampleInput>) => {
    const v = incident.violations[vIdx]
    updateViolation(vIdx, { examples: v.examples.map((e, i) => i === eIdx ? { ...e, ...partial } : e) })
  }

  const removeExample = (vIdx: number, eIdx: number) => {
    const v = incident.violations[vIdx]
    updateViolation(vIdx, { examples: v.examples.filter((_, i) => i !== eIdx) })
  }

  const addManual = () => {
    const v = incident.violations[0]
    if (!v) return
    updateViolation(0, { examples: [...v.examples, newExample('MANUAL', v.examples.length)] })
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-white">
      <div className="flex items-center gap-2 justify-between">
        <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-widest">
          Incident #{incIdx + 1}
        </p>
        <Button type="button" variant="ghost" size="sm"
          className="h-6 text-[12px] text-red-400 hover:text-red-600 hover:bg-red-50"
          onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
        </Button>
      </div>

      {/* 1. Policy Violated + Reference Material */}
      <div className="space-y-3">
        {incident.violations.map((v, vIdx) => (
          <ViolationPolicyFields key={vIdx} violation={v}
            onChange={p => updateViolation(vIdx, p)}
            onRemove={() => removeViolation(vIdx)} />
        ))}
        <Button type="button" variant="outline" size="sm" className="text-[12px] w-full"
          onClick={addViolation}>
          <Plus className="h-3 w-3 mr-1" /> Add Another Policy Violation
        </Button>
      </div>

      {/* 2. Description */}
      <Field label="Description" required>
        <RichTextEditor className="text-[13px] min-h-[56px]"
          placeholder="Describe what occurred…"
          value={incident.description}
          onChange={html => onChange({ description: html })} />
      </Field>

      {/* 3. Examples (single consolidated section) */}
      <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/30">
        {allExamples.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-100 px-3 py-1">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest pt-2 pb-1">
              Examples
            </p>
            <div className="flex gap-2 items-center mb-1">
              <div className="flex-1 grid grid-cols-[160px_1fr] gap-2">
                <span className="text-[13px] font-medium text-slate-700">Date</span>
                <span className="text-[13px] font-medium text-slate-700">Description</span>
              </div>
              <div className="w-6 shrink-0" />
            </div>
            {allExamples.map(({ ex, vIdx, eIdx }) => (
              <ExampleRow key={`${vIdx}-${eIdx}`} example={ex}
                onChange={p => updateExample(vIdx, eIdx, p)}
                onRemove={() => removeExample(vIdx, eIdx)} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]"
            onClick={addManual}>
            <Plus className="h-3 w-3 mr-1" /> Add Manually
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]"
            onClick={onOpenQa}>
            <Search className="h-3 w-3 mr-1" /> Search QA Records
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

export function IncidentsSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const [qaModal, setQaModal] = useState<ModalTarget | null>(null)

  const updateIncident = (incIdx: number, partial: Partial<IncidentInput>) =>
    update('incidents', form.incidents.map((inc, i) => i === incIdx ? { ...inc, ...partial } : inc))

  const removeIncident = (incIdx: number) =>
    update('incidents', form.incidents.filter((_, i) => i !== incIdx))

  const addIncident = () =>
    update('incidents', [...form.incidents, newIncident(form.incidents.length)])

  const addExamplesToIncident = ({ incIdx }: ModalTarget, examples: ExampleInput[]) => {
    const incidents = form.incidents.map((inc, i) => {
      if (i !== incIdx) return inc
      const violations = [...inc.violations]
      if (violations.length === 0) return inc
      violations[0] = { ...violations[0], examples: [...violations[0].examples, ...examples] }
      return { ...inc, violations }
    })
    update('incidents', incidents)
  }

  return (
    <FormSection title="Incidents">
      <div className="space-y-4">
        {form.incidents.length === 0 && (
          <p className="text-[13px] text-slate-400 text-center py-4">
            No incidents added yet. Click below to add one.
          </p>
        )}
        {form.incidents.map((inc, incIdx) => (
          <IncidentBlock
            key={incIdx}
            incident={inc}
            incIdx={incIdx}
            onChange={p => updateIncident(incIdx, p)}
            onRemove={() => removeIncident(incIdx)}
            onOpenQa={() => setQaModal({ incIdx })}
          />
        ))}
        <Button type="button" variant="outline" className="w-full text-[13px]" onClick={addIncident}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Incident
        </Button>
      </div>

      <Dialog open={!!qaModal} onOpenChange={open => !open && setQaModal(null)}>
        {qaModal && (
          <QaSearchModal
            csrId={form.csr_id}
            onImport={examples => addExamplesToIncident(qaModal, examples)}
            onClose={() => setQaModal(null)}
          />
        )}
      </Dialog>

    </FormSection>
  )
}
