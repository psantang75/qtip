/**
 * Reusable section components for CoachingSessionFormPage.
 * Keeps the main page file focused on state / logic.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Search, Paperclip } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import type {
  CoachingPurpose, CoachingFormat, CoachingSourceType, TrainingResource, LibraryQuiz,
} from '@/services/trainingService'
import type { Topic } from '@/services/topicService'
import type { CoachingFormState, CoachingFormErrors } from './types'

// ── Primitives ────────────────────────────────────────────────────────────────

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-3 mb-4">{title}</h3>
      {children}
    </div>
  )
}

export function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[12px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

const sel = 'w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40'
const inp = 'w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40'
const tex = 'w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-primary/40'

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 mt-4 border-t border-slate-100">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  )
}

// ── Topic multi-select ────────────────────────────────────────────────────────

function TopicMultiSelect({ topics, selectedIds, onToggle, error }: {
  topics: Topic[]; selectedIds: number[]; onToggle: (id: number) => void; error?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen]     = useState(false)

  const filtered       = topics.filter(t => t.topic_name.toLowerCase().includes(search.toLowerCase()))
  const selectedTopics = topics.filter(t => selectedIds.includes(t.id))
  const label = selectedTopics.length === 0
    ? 'Select topics…'
    : `${selectedTopics.length} topic${selectedTopics.length !== 1 ? 's' : ''} selected`

  return (
    <div>
      <DropdownMenu open={open} onOpenChange={o => { setOpen(o); if (o) setSearch('') }}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${sel} flex items-center justify-between ${error ? 'border-red-400' : ''}`}
          >
            <span className={selectedIds.length === 0 ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[380px] p-0" onCloseAutoFocus={e => e.preventDefault()}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              className="flex-1 text-[13px] focus:outline-none placeholder:text-slate-400"
              placeholder="Search topics…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-400">No topics match</p>
            )}
            {filtered.map(t => (
              <DropdownMenuCheckboxItem
                key={t.id}
                checked={selectedIds.includes(t.id)}
                onCheckedChange={() => onToggle(t.id)}
                onSelect={e => e.preventDefault()}
              >
                {t.topic_name}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
          {selectedTopics.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <p className="text-[11px] text-primary font-medium">{selectedTopics.length} selected</p>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedTopics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedTopics.map(t => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 text-[13px] rounded-md border border-slate-200"
            >
              {t.topic_name}
              <button
                type="button"
                onClick={() => onToggle(t.id)}
                className="text-slate-400 hover:text-slate-600 leading-none"
              >×</button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-[12px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// ── Section 1: Session (Info + Notes combined) ───────────────────────────────

const NOTES_PLACEHOLDER: Record<CoachingPurpose, string> = {
  WEEKLY:      'Summarize performance trends, strengths, and focus areas...',
  PERFORMANCE: 'Describe the specific gap or pattern being addressed...',
  ONBOARDING:  'Describe the onboarding topic and key points covered...',
}

interface S1Props {
  form: CoachingFormState; errors: CoachingFormErrors
  csrs: { id: number; name: string; department: string }[]
  coaches: { id: number; name: string }[]
  topics: Topic[]
  isEdit?: boolean
  update: (k: keyof CoachingFormState, v: any) => void
  toggleTopic: (id: number) => void
}

export function SessionSection({ form, errors, csrs, coaches, topics, isEdit, update, toggleTopic }: S1Props) {
  const toggleCsr = (csrId: number) => {
    const next = form.csr_ids.includes(csrId)
      ? form.csr_ids.filter(x => x !== csrId)
      : [...form.csr_ids, csrId]
    update('csr_ids', next)
  }
  const selectedCsrs = csrs.filter(c => form.csr_ids.includes(c.id))

  return (
    <FormSection title="Session">
      {/* Scheduling fields */}
      <div className="grid grid-cols-2 gap-4">
        {isEdit ? (
          /* Editing: show CSR as read-only */
          <div>
            <p className="text-[13px] font-medium text-slate-700 mb-1">CSR</p>
            <p className="text-[13px] text-slate-600 h-9 flex items-center">
              {selectedCsrs.map(c => c.name).join(', ') || csrs.find(c => form.csr_ids.includes(c.id))?.name || '—'}
            </p>
          </div>
        ) : (
          /* Creating: multi-select CSRs */
          <Field label="CSR(s)" required error={(errors as any).csr_ids}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={`${sel} flex items-center justify-between`}>
                  <span className={form.csr_ids.length === 0 ? 'text-slate-400' : 'text-slate-700'}>
                    {form.csr_ids.length === 0 ? 'Select CSR(s)…'
                      : form.csr_ids.length === 1 ? selectedCsrs[0]?.name
                      : `${form.csr_ids.length} CSRs selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[340px] max-h-[280px] overflow-y-auto py-1" onCloseAutoFocus={e => e.preventDefault()}>
                {csrs.map(c => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={form.csr_ids.includes(c.id)}
                    onCheckedChange={() => toggleCsr(c.id)}
                    onSelect={e => e.preventDefault()}
                  >
                    {c.name} — {c.department}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedCsrs.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedCsrs.map(c => (
                  <span key={c.id} className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 text-slate-700 text-[12px] rounded-md border border-slate-200">
                    {c.name}
                    <button type="button" onClick={() => toggleCsr(c.id)} className="text-slate-400 hover:text-slate-600">×</button>
                  </span>
                ))}
              </div>
            )}
            {selectedCsrs.length > 1 && (
              <p className="text-[11px] text-primary mt-1">{selectedCsrs.length} sessions will be created</p>
            )}
          </Field>
        )}
        <Field label="Session Date" required error={errors.session_date}>
          <input type="datetime-local" className={inp} value={form.session_date}
            onChange={e => update('session_date', e.target.value)} />
        </Field>
        <Field label="Coaching Purpose" required error={errors.coaching_purpose}>
          <select className={sel} value={form.coaching_purpose} onChange={e => update('coaching_purpose', e.target.value as CoachingPurpose)}>
            <option value="">Select purpose…</option>
            <option value="WEEKLY">Weekly Performance</option>
            <option value="PERFORMANCE">Performance</option>
            <option value="ONBOARDING">Onboarding</option>
          </select>
        </Field>
        <Field label="Source" required error={errors.source_type}>
          <select className={sel} value={form.source_type} onChange={e => update('source_type', e.target.value as CoachingSourceType)}>
            <option value="">Select source…</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="QA_AUDIT">QA Audit</option>
            <option value="MANAGER_OBSERVATION">Manager Observation</option>
            <option value="TREND">Trend</option>
            <option value="DISPUTE">Dispute</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Coaching Format" required error={errors.coaching_format}>
          <select className={sel} value={form.coaching_format} onChange={e => update('coaching_format', e.target.value as CoachingFormat)}>
            <option value="">Select format…</option>
            <option value="ONE_ON_ONE">1-on-1</option>
            <option value="SIDE_BY_SIDE">Side-by-Side</option>
            <option value="TEAM_SESSION">Team Session</option>
          </select>
        </Field>
        <Field label="Coach">
          <select
            className={sel}
            value={form.coach_id || ''}
            onChange={e => update('coach_id', Number(e.target.value))}
          >
            <option value="">Select coach…</option>
            {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      {/* Session content */}
      <div className="border-t border-slate-100 pt-4 mt-4 space-y-4">
        <Field label="Topics" required>
          <TopicMultiSelect
            topics={topics}
            selectedIds={form.topic_ids}
            onToggle={toggleTopic}
            error={errors.topic_ids}
          />
        </Field>
        <Field label="Notes" required error={errors.notes}>
          <textarea
            className={tex} rows={5} maxLength={3000} value={form.notes}
            placeholder={form.coaching_purpose ? NOTES_PLACEHOLDER[form.coaching_purpose as CoachingPurpose] : 'Enter session notes…'}
            onChange={e => update('notes', e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mt-1 text-right">{form.notes.length}/3000</p>
        </Field>
      </div>
    </FormSection>
  )
}

// ── Shared multi-select for resources / quizzes ───────────────────────────────

function AssignmentMultiSelect<T extends { id: number; label: string; topics: number[] }>({
  items, selectedIds, onToggle, placeholder, noTopicsMsg, search, setSearch,
}: {
  items: T[]; selectedIds: number[]; onToggle: (id: number) => void
  placeholder: string; noTopicsMsg: string
  search: string; setSearch: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const filtered = items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
  const selected  = items.filter(i => selectedIds.includes(i.id))
  const label = selected.length === 0
    ? placeholder
    : `${selected.length} selected`

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">{noTopicsMsg}</p>
      ) : (
        <DropdownMenu open={open} onOpenChange={o => { setOpen(o); if (o) setSearch('') }}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={`${sel} flex items-center justify-between`}>
              <span className={selected.length === 0 ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[420px] p-0" onCloseAutoFocus={e => e.preventDefault()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
              <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <input
                className="flex-1 text-[13px] focus:outline-none placeholder:text-slate-400"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
              />
            </div>
            <div className="max-h-[220px] overflow-y-auto py-1">
              {filtered.length === 0 && <p className="px-3 py-2 text-[12px] text-slate-400">No matches</p>}
              {filtered.map(i => (
                <DropdownMenuCheckboxItem
                  key={i.id}
                  checked={selectedIds.includes(i.id)}
                  onCheckedChange={() => onToggle(i.id)}
                  onSelect={e => e.preventDefault()}
                >
                  {i.label}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
            {selected.length > 0 && (
              <div className="border-t border-slate-100 px-3 py-2">
                <p className="text-[11px] text-primary font-medium">{selected.length} selected</p>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selected.map(i => (
            <span key={i.id} className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 text-[13px] rounded-md border border-slate-200">
              {i.label}
              <button type="button" onClick={() => onToggle(i.id)} className="text-slate-400 hover:text-slate-600 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Section 3: Required Actions ───────────────────────────────────────────────

interface S3Props {
  form: CoachingFormState; errors: CoachingFormErrors
  resources: TrainingResource[]
  quizzes: LibraryQuiz[]
  update: (k: keyof CoachingFormState, v: any) => void
}

export function RequiredActionsSection({ form, errors, resources, quizzes, update }: S3Props) {
  const [kbSearch,   setKbSearch]   = useState('')
  const [quizSearch, setQuizSearch] = useState('')

  // Filter resources and quizzes to those linked to the session's selected topics
  const topicSet = new Set(form.topic_ids)
  const filteredResources = resources.filter(r =>
    topicSet.size === 0 || r.topic_ids.some(tid => topicSet.has(tid))
  )
  const filteredQuizzes = quizzes.filter(q =>
    topicSet.size === 0 || q.topic_ids.some(tid => topicSet.has(tid))
  )

  const resourceItems = filteredResources.map(r => ({
    id: r.id,
    label: `${r.title} — ${r.resource_type}`,
    topics: r.topic_ids,
  }))
  const quizItems = filteredQuizzes.map(q => ({
    id: q.id,
    label: `${q.quiz_title} — ${q.question_count}Q · Pass: ${q.pass_score}%`,
    topics: q.topic_ids,
  }))

  const toggleResource = (id: number) => {
    const next = form.kb_resource_ids.includes(id)
      ? form.kb_resource_ids.filter(x => x !== id)
      : [...form.kb_resource_ids, id]
    update('kb_resource_ids', next)
  }
  const toggleQuiz = (id: number) => {
    const next = form.quiz_ids.includes(id)
      ? form.quiz_ids.filter(x => x !== id)
      : [...form.quiz_ids, id]
    update('quiz_ids', next)
  }

  return (
    <FormSection title="Required Actions">
      {/* Required Action Notes */}
      <Field label="Required Action">
        <textarea
          className={tex} rows={3} maxLength={1000} value={form.required_action}
          placeholder="Describe what must change or improve…"
          onChange={e => update('required_action', e.target.value)}
        />
        <p className="text-[11px] text-slate-400 mt-1">
          {form.required_action.length}/1000 · Shown prominently to the CSR as what must change.
        </p>
      </Field>

      {/* Reference Materials */}
      <SubSection title="Reference Materials">
        <AssignmentMultiSelect
          items={resourceItems}
          selectedIds={form.kb_resource_ids}
          onToggle={toggleResource}
          placeholder="Assign Reference Materials…"
          noTopicsMsg="No resources linked to the selected topics."
          search={kbSearch}
          setSearch={setKbSearch}
        />
      </SubSection>

      {/* Quiz */}
      <SubSection title="Quiz Assignment">
        <AssignmentMultiSelect
          items={quizItems}
          selectedIds={form.quiz_ids}
          onToggle={toggleQuiz}
          placeholder="Assign quizzes…"
          noTopicsMsg="No quizzes linked to the selected topics."
          search={quizSearch}
          setSearch={setQuizSearch}
        />
      </SubSection>

    </FormSection>
  )
}

// ── Section 4: CSR Accountability (with Timing) ──────────────────────────────

interface S4Props {
  form: CoachingFormState
  errors: CoachingFormErrors
  update: (k: keyof CoachingFormState, v: any) => void
}

export function AccountabilitySection({ form, errors, update }: S4Props) {
  return (
    <FormSection title="CSR Accountability">
      {/* Accountability toggles */}
      <div className="space-y-4">
        {([
          ['require_action_plan',    'Require Action Plan',    'CSR must write a response before completing'],
          ['require_acknowledgment', 'Require Acknowledgment', 'CSR must check the acknowledgment box'],
        ] as const).map(([key, label, helper]) => (
          <div key={key} className="flex items-start gap-3">
            <Switch checked={form[key]} onCheckedChange={v => update(key, v)} className="mt-0.5" />
            <div>
              <p className="text-[13px] font-medium text-slate-700">{label}</p>
              <p className="text-[12px] text-slate-400">{helper}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Timing — due dates govern when the CSR must complete their work */}
      <SubSection title="Timing">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Due Date">
            <input type="date" className={inp} value={form.due_date} onChange={e => update('due_date', e.target.value)} />
          </Field>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={form.follow_up_required} onCheckedChange={v => update('follow_up_required', v)} />
            <span className="text-[13px] text-slate-700">Follow-Up Required</span>
          </div>
          {form.follow_up_required && (
            <Field label="Follow-Up Date" error={errors.follow_up_date}>
              <input type="date" className={inp} value={form.follow_up_date} onChange={e => update('follow_up_date', e.target.value)} />
            </Field>
          )}
        </div>
        {form.follow_up_required && (
          <div className="mt-4">
            <Field label="Follow-Up Notes">
              <textarea
                className={tex} rows={4} maxLength={3000} value={form.follow_up_notes}
                placeholder="Document notes from the follow-up meeting…"
                onChange={e => update('follow_up_notes', e.target.value)}
              />
              <p className="text-[11px] text-slate-400 mt-1 text-right">{form.follow_up_notes.length}/3000</p>
            </Field>
          </div>
        )}
      </SubSection>
    </FormSection>
  )
}

// ── Behavior flags definition ─────────────────────────────────────────────────

export const BEHAVIOR_FLAG_GROUPS: { label: string; flags: { value: string; text: string }[] }[] = [
  {
    label: 'Risk Signals',
    flags: [
      { value: 'RESISTANCE_TO_FEEDBACK',    text: 'Resistance to Feedback' },
      { value: 'LACK_OF_ACCOUNTABILITY',    text: 'Lack of Accountability' },
      { value: 'BLAMING_EXTERNAL_FACTORS',  text: 'Blaming External Factors' },
      { value: 'LOW_ENGAGEMENT',            text: 'Low Engagement' },
      { value: 'REPEATED_ISSUE',            text: 'Repeated Issue (Same Topic)' },
      { value: 'COACHING_NOT_TAKEN_SERIOUSLY', text: 'Coaching Not Taken Seriously' },
    ],
  },
  {
    label: 'Observational',
    flags: [
      { value: 'NEEDS_ADDITIONAL_SUPPORT', text: 'Needs Additional Support' },
      { value: 'PROCESS_CONFUSION',        text: 'Process Confusion' },
      { value: 'SYSTEM_KNOWLEDGE_GAP',     text: 'System Knowledge Gap' },
    ],
  },
  {
    label: 'Positive',
    flags: [
      { value: 'STRONG_IMPROVEMENT', text: 'Strong Improvement' },
      { value: 'HIGHLY_ENGAGED',     text: 'Highly Engaged' },
      { value: 'TOOK_OWNERSHIP',     text: 'Took Ownership' },
    ],
  },
]

// ── Behavior flag multi-select dropdown ───────────────────────────────────────

function BehaviorFlagSelect({ selected, onToggle }: {
  selected: string[]; onToggle: (v: string) => void
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')

  const allFlat = BEHAVIOR_FLAG_GROUPS.flatMap(g => g.flags)
  const selectedFlags = allFlat.filter(f => selected.includes(f.value))
  const label = selectedFlags.length === 0
    ? 'Select behavior flags…'
    : `${selectedFlags.length} flag${selectedFlags.length !== 1 ? 's' : ''} selected`

  return (
    <div>
      <DropdownMenu open={open} onOpenChange={o => { setOpen(o); if (o) setSearch('') }}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={`${sel} flex items-center justify-between`}>
            <span className={selectedFlags.length === 0 ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[380px] p-0" onCloseAutoFocus={e => e.preventDefault()}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              className="flex-1 text-[13px] focus:outline-none placeholder:text-slate-400"
              placeholder="Search flags…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {BEHAVIOR_FLAG_GROUPS.map((group, gi) => {
              const filtered = group.flags.filter(f =>
                !search || f.text.toLowerCase().includes(search.toLowerCase())
              )
              if (!filtered.length) return null
              return (
                <DropdownMenuGroup key={group.label}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                    {group.label}
                  </DropdownMenuLabel>
                  {filtered.map(f => (
                    <DropdownMenuCheckboxItem
                      key={f.value}
                      checked={selected.includes(f.value)}
                      onCheckedChange={() => onToggle(f.value)}
                      onSelect={e => e.preventDefault()}
                    >
                      {f.text}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              )
            })}
          </div>
          {selectedFlags.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <p className="text-[11px] text-primary font-medium">{selectedFlags.length} selected</p>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedFlags.map(f => (
            <span key={f.value}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 text-[13px] rounded-md border border-slate-200">
              {f.text}
              <button type="button" onClick={() => onToggle(f.value)}
                className="text-slate-400 hover:text-slate-600 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Section 5: Internal Notes (trainer/manager/admin only) ───────────────────

interface S5InternalProps {
  form: CoachingFormState
  update: (k: keyof CoachingFormState, v: any) => void
}

export function InternalNotesSection({ form, update }: S5InternalProps) {
  const allFlags = form.behavior_flags ?? []

  const toggleFlag = (value: string) => {
    update(
      'behavior_flags',
      allFlags.includes(value) ? allFlags.filter(f => f !== value) : [...allFlags, value]
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">Internal Notes</h3>
        <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">Private — Not visible to CSR</span>
      </div>
      <div className="p-5 space-y-4">
        {/* Behavior flags dropdown — first */}
        <Field label="Behavior Flags">
          <BehaviorFlagSelect selected={allFlags} onToggle={toggleFlag} />
        </Field>

        {/* Internal notes text — second */}
        <Field label="Internal Notes">
          <textarea
            className={tex} rows={4} maxLength={3000} value={form.internal_notes}
            placeholder="Context, observations, concerns (e.g. CSR was defensive, blamed system, appears disengaged)…"
            onChange={e => update('internal_notes', e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mt-1 text-right">{form.internal_notes.length}/3000</p>
        </Field>
      </div>
    </div>
  )
}

// ── Section 6: Attachment (optional) ─────────────────────────────────────────

interface S4Props {
  form: CoachingFormState; update: (k: keyof CoachingFormState, v: any) => void
  existingFilename?: string; onRemoveExisting: () => void
}

export function AttachmentSection({ form, update, existingFilename, onRemoveExisting }: S4Props) {
  const [expanded, setExpanded] = useState(!!(existingFilename || form.attachment_file))

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        {expanded
          ? <ChevronDown  className="h-4 w-4 text-slate-400 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
        }
        <Paperclip className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-sm font-semibold text-slate-700">Attachment</span>
        <span className="text-[11px] text-slate-400">(optional)</span>
        {(existingFilename || form.attachment_file) && (
          <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-1">1 file</span>
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4">
          {existingFilename && (
            <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg mb-3">
              <span className="text-[13px] text-slate-700 truncate">{existingFilename}</span>
              <button type="button" onClick={onRemoveExisting} className="text-[12px] text-red-500 hover:text-red-700 ml-3 shrink-0">Remove</button>
            </div>
          )}
          <input
            type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            className="w-full text-[13px] text-slate-600 file:mr-3 file:py-1 file:px-3 file:border-0 file:rounded file:bg-primary/10 file:text-primary file:text-[12px] file:cursor-pointer"
            onChange={e => update('attachment_file', e.target.files?.[0] ?? null)}
          />
          <p className="text-[11px] text-slate-400 mt-1">Max 10 MB · PDF, Word, Images</p>
        </div>
      )}
    </div>
  )
}
