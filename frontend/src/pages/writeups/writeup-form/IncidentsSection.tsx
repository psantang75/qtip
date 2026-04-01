import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { FormSection, Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { QaSearchModal } from './SearchModals'
import listService from '@/services/listService'
import {
  newIncident, newViolation, newExample,
  type WriteUpFormState, type IncidentInput, type ViolationInput, type ExampleInput,
} from './types'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

type ModalTarget = { incIdx: number; vIdx: number }

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
        <Textarea
          rows={2}
          className="text-[12px] resize-none min-h-[56px]"
          placeholder="Describe the example…"
          value={example.description}
          onChange={e => onChange({ description: e.target.value })}
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

function ViolationBlock({ violation, onChange, onRemove, onOpenQa }: {
  violation: ViolationInput
  onChange: (partial: Partial<ViolationInput>) => void
  onRemove: () => void
  onOpenQa: () => void
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

  // Preserve any existing value that isn't in the list (e.g. legacy free-text)
  const policyNotInList = violation.policy_violated &&
    !activePolicy.some(i => i.label === violation.policy_violated)
  const refNotInList = violation.reference_material &&
    !activeReference.some(i => i.label === violation.reference_material)

  const updateExample = (eIdx: number, partial: Partial<ExampleInput>) =>
    onChange({ examples: violation.examples.map((e, i) => i === eIdx ? { ...e, ...partial } : e) })

  const removeExample = (eIdx: number) =>
    onChange({ examples: violation.examples.filter((_, i) => i !== eIdx) })

  const addManual = () =>
    onChange({ examples: [...violation.examples, newExample('MANUAL', violation.examples.length)] })

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/30">
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

      {violation.examples.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-100 px-3 py-1">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest pt-2 pb-1">
            Examples
          </p>
          {/* Column headers — mirrors ExampleRow layout; mb-1 matches Field label spacing */}
          <div className="flex gap-2 items-center mb-1">
            <div className="flex-1 grid grid-cols-[160px_1fr] gap-2">
              <span className="text-[13px] font-medium text-slate-700">Date</span>
              <span className="text-[13px] font-medium text-slate-700">Description</span>
            </div>
            <div className="w-6 shrink-0" />
          </div>
          {violation.examples.map((ex, eIdx) => (
            <ExampleRow key={eIdx} example={ex}
              onChange={p => updateExample(eIdx, p)}
              onRemove={() => removeExample(eIdx)} />
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
        <Button type="button" variant="ghost" size="sm"
          className="h-7 text-[12px] text-red-400 hover:text-red-600 hover:bg-red-50 ml-auto"
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
  onOpenQa: (vIdx: number) => void
}) {
  const updateViolation = (vIdx: number, partial: Partial<ViolationInput>) =>
    onChange({ violations: incident.violations.map((v, i) => i === vIdx ? { ...v, ...partial } : v) })

  const removeViolation = (vIdx: number) =>
    onChange({ violations: incident.violations.filter((_, i) => i !== vIdx) })

  const addViolation = () =>
    onChange({ violations: [...incident.violations, newViolation(incident.violations.length)] })

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-white">
      <div className="flex items-center gap-2 justify-between">
        <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-widest">
          Incident {incIdx + 1}
        </p>
        <Button type="button" variant="ghost" size="sm"
          className="h-6 text-[12px] text-red-400 hover:text-red-600 hover:bg-red-50"
          onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
        </Button>
      </div>

      <Field label="Description" required>
        <Textarea rows={2} className="text-[13px] resize-none min-h-[56px]"
          placeholder="Describe what occurred…"
          value={incident.description}
          onChange={e => onChange({ description: e.target.value })} />
      </Field>

      <div className="space-y-3">
        <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-widest">
          Policy Violations
        </p>
        {incident.violations.map((v, vIdx) => (
          <ViolationBlock key={vIdx} violation={v}
            onChange={p => updateViolation(vIdx, p)}
            onRemove={() => removeViolation(vIdx)}
            onOpenQa={() => onOpenQa(vIdx)} />
        ))}
        <Button type="button" variant="outline" size="sm" className="text-[12px] w-full"
          onClick={addViolation}>
          <Plus className="h-3 w-3 mr-1" /> Add Another Policy Violation
        </Button>
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

  const addExamplesToViolation = ({ incIdx, vIdx }: ModalTarget, examples: ExampleInput[]) => {
    const incidents = form.incidents.map((inc, i) => {
      if (i !== incIdx) return inc
      return {
        ...inc,
        violations: inc.violations.map((v, vi) => {
          if (vi !== vIdx) return v
          return { ...v, examples: [...v.examples, ...examples] }
        }),
      }
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
            onOpenQa={vIdx => setQaModal({ incIdx, vIdx })}
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
            onImport={examples => addExamplesToViolation(qaModal, examples)}
            onClose={() => setQaModal(null)}
          />
        )}
      </Dialog>

    </FormSection>
  )
}
