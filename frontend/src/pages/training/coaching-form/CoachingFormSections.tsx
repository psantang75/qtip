/**
 * Reusable section components for CoachingSessionFormPage.
 * Keeps the main page file focused on state / logic.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Search, Paperclip, X } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import type {
  CoachingPurpose, CoachingFormat, CoachingSourceType, TrainingResource, LibraryQuiz,
} from '@/services/trainingService'
import type { ListItem } from '@/services/listService'
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

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 mt-4 border-t border-slate-100">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  )
}

// ── Chip dismiss button ───────────────────────────────────────────────────────

function ChipRemove({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm"
      className="h-auto w-auto p-0 ml-0.5 text-slate-400 hover:text-slate-600 hover:bg-transparent leading-none"
      onClick={onClick}>
      <X className="h-3 w-3" />
    </Button>
  )
}

// ── Topic multi-select ────────────────────────────────────────────────────────

function TopicMultiSelect({ topicItems, selectedIds, onToggle, error }: {
  topicItems: ListItem[]; selectedIds: number[]; onToggle: (id: number) => void; error?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen]     = useState(false)

  const selectedTopics = topicItems.filter(t => selectedIds.includes(t.id))
  const label = selectedTopics.length === 0
    ? 'Select topics…'
    : `${selectedTopics.length} topic${selectedTopics.length !== 1 ? 's' : ''} selected`

  const hasCategories = topicItems.some(t => t.category)
  const categories    = hasCategories ? [...new Set(topicItems.map(t => t.category ?? 'General'))] : []
  const matchesSearch = (t: ListItem) => !search || t.label.toLowerCase().includes(search.toLowerCase())

  return (
    <div>
      <DropdownMenu open={open} onOpenChange={o => { setOpen(o); if (o) setSearch('') }}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline"
            className={`w-full justify-between font-normal text-[13px] h-9 ${error ? 'border-red-400' : ''}`}>
            <span className={selectedIds.length === 0 ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[380px] p-0" onCloseAutoFocus={e => e.preventDefault()}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <Input
              className="flex-1 border-0 h-7 text-[13px] focus-visible:ring-0 px-0 placeholder:text-slate-400"
              placeholder="Search topics…" value={search}
              onChange={e => setSearch(e.target.value)} onKeyDown={e => e.stopPropagation()} />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {hasCategories ? (
              categories.map((cat, ci) => {
                const items = topicItems.filter(t => (t.category ?? 'General') === cat && matchesSearch(t))
                if (!items.length) return null
                return (
                  <DropdownMenuGroup key={cat}>
                    {ci > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                      {cat}
                    </DropdownMenuLabel>
                    {items.map(t => (
                      <DropdownMenuCheckboxItem key={t.id} checked={selectedIds.includes(t.id)}
                        onCheckedChange={() => onToggle(t.id)} onSelect={e => e.preventDefault()}>
                        {t.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                )
              })
            ) : (
              topicItems.filter(matchesSearch).map(t => (
                <DropdownMenuCheckboxItem key={t.id} checked={selectedIds.includes(t.id)}
                  onCheckedChange={() => onToggle(t.id)} onSelect={e => e.preventDefault()}>
                  {t.label}
                </DropdownMenuCheckboxItem>
              ))
            )}
            {topicItems.filter(matchesSearch).length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-400">No topics match</p>
            )}
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
            <span key={t.id}
              className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-700 text-[13px] rounded-md border border-slate-200">
              {t.category && <span className="text-[10px] text-slate-400 font-medium">{t.category} ·</span>}
              {t.label}
              <ChipRemove onClick={() => onToggle(t.id)} />
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
  topicItems?: ListItem[]
  purposeItems?: { item_key?: string; label: string }[]
  formatItems?:  { item_key?: string; label: string }[]
  sourceItems?:  { item_key?: string; label: string }[]
  isEdit?: boolean
  update: (k: keyof CoachingFormState, v: any) => void
  toggleTopic: (id: number) => void
}

const DEFAULT_PURPOSES = [
  { item_key: 'WEEKLY', label: 'Weekly' },
  { item_key: 'PERFORMANCE', label: 'Performance' },
  { item_key: 'ONBOARDING', label: 'Onboarding' },
]
const DEFAULT_FORMATS = [
  { item_key: 'ONE_ON_ONE',   label: '1-on-1' },
  { item_key: 'SIDE_BY_SIDE', label: 'Side-by-Side' },
  { item_key: 'TEAM_SESSION', label: 'Team Session' },
]
const DEFAULT_SOURCES = [
  { item_key: 'SCHEDULED',           label: 'Scheduled' },
  { item_key: 'QA_AUDIT',            label: 'QA Audit' },
  { item_key: 'MANAGER_OBSERVATION', label: 'Manager Observation' },
  { item_key: 'TREND',               label: 'Trend' },
  { item_key: 'DISPUTE',             label: 'Dispute' },
  { item_key: 'OTHER',               label: 'Other' },
]

export function SessionSection({ form, errors, csrs, coaches, topicItems = [],
  purposeItems, formatItems, sourceItems,
  isEdit, update, toggleTopic }: S1Props) {
  const purposes = (purposeItems?.length ? purposeItems : DEFAULT_PURPOSES)
  const formats  = (formatItems?.length  ? formatItems  : DEFAULT_FORMATS)
  const sources  = (sourceItems?.length  ? sourceItems  : DEFAULT_SOURCES)
  const toggleCsr = (csrId: number) => {
    const next = form.csr_ids.includes(csrId)
      ? form.csr_ids.filter(x => x !== csrId)
      : [...form.csr_ids, csrId]
    update('csr_ids', next)
  }
  const selectedCsrs = csrs.filter(c => form.csr_ids.includes(c.id))

  return (
    <FormSection title="Session">
      <div className="grid grid-cols-2 gap-4">
        {isEdit ? (
          <div>
            <p className="text-[13px] font-medium text-slate-700 mb-1">CSR</p>
            <p className="text-[13px] text-slate-600 h-9 flex items-center">
              {selectedCsrs.map(c => c.name).join(', ') || csrs.find(c => form.csr_ids.includes(c.id))?.name || '—'}
            </p>
          </div>
        ) : (
          <Field label="CSR(s)" required error={(errors as any).csr_ids}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between font-normal text-[13px] h-9">
                  <span className={form.csr_ids.length === 0 ? 'text-slate-400' : 'text-slate-700'}>
                    {form.csr_ids.length === 0 ? 'Select CSR(s)…'
                      : form.csr_ids.length === 1 ? selectedCsrs[0]?.name
                      : `${form.csr_ids.length} CSRs selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[340px] max-h-[280px] overflow-y-auto py-1" onCloseAutoFocus={e => e.preventDefault()}>
                {csrs.map(c => (
                  <DropdownMenuCheckboxItem key={c.id} checked={form.csr_ids.includes(c.id)}
                    onCheckedChange={() => toggleCsr(c.id)} onSelect={e => e.preventDefault()}>
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
                    <ChipRemove onClick={() => toggleCsr(c.id)} />
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
          <Input type="datetime-local" value={form.session_date}
            onChange={e => update('session_date', e.target.value)} />
        </Field>
        <Field label="Coaching Purpose" required error={errors.coaching_purpose}>
          <Select value={form.coaching_purpose} onValueChange={v => update('coaching_purpose', v as CoachingPurpose)}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select purpose…" />
            </SelectTrigger>
            <SelectContent>
              {purposes.filter(p => p.item_key).map(p => (
                <SelectItem key={p.item_key} value={p.item_key!}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Source" required error={errors.source_type}>
          <Select value={form.source_type} onValueChange={v => update('source_type', v as CoachingSourceType)}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select source…" />
            </SelectTrigger>
            <SelectContent>
              {sources.filter(s => s.item_key).map(s => (
                <SelectItem key={s.item_key} value={s.item_key!}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Coaching Format" required error={errors.coaching_format}>
          <Select value={form.coaching_format} onValueChange={v => update('coaching_format', v as CoachingFormat)}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select format…" />
            </SelectTrigger>
            <SelectContent>
              {formats.filter(f => f.item_key).map(f => (
                <SelectItem key={f.item_key} value={f.item_key!}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Coach">
          <Select value={form.coach_id ? String(form.coach_id) : ''} onValueChange={v => update('coach_id', Number(v))}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select coach…" />
            </SelectTrigger>
            <SelectContent>
              {coaches.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="border-t border-slate-100 pt-4 mt-4 space-y-4">
        <Field label="Topics" required>
          <TopicMultiSelect
            topicItems={topicItems}
            selectedIds={form.topic_ids}
            onToggle={toggleTopic}
            error={errors.topic_ids}
          />
        </Field>
        <Field label="Notes" required error={errors.notes}>
          <Textarea
            rows={5} maxLength={3000} value={form.notes}
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
  const label = selected.length === 0 ? placeholder : `${selected.length} selected`

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic">{noTopicsMsg}</p>
      ) : (
        <DropdownMenu open={open} onOpenChange={o => { setOpen(o); if (o) setSearch('') }}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="w-full justify-between font-normal text-[13px] h-9">
              <span className={selected.length === 0 ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[420px] p-0" onCloseAutoFocus={e => e.preventDefault()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
              <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <Input
                className="flex-1 border-0 h-7 text-[13px] focus-visible:ring-0 px-0 placeholder:text-slate-400"
                placeholder="Search…" value={search}
                onChange={e => setSearch(e.target.value)} onKeyDown={e => e.stopPropagation()} />
            </div>
            <div className="max-h-[220px] overflow-y-auto py-1">
              {filtered.length === 0 && <p className="px-3 py-2 text-[12px] text-slate-400">No matches</p>}
              {filtered.map(i => (
                <DropdownMenuCheckboxItem key={i.id} checked={selectedIds.includes(i.id)}
                  onCheckedChange={() => onToggle(i.id)} onSelect={e => e.preventDefault()}>
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
            <span key={i.id} className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-700 text-[13px] rounded-md border border-slate-200">
              {i.label}
              <ChipRemove onClick={() => onToggle(i.id)} />
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
  topicIdMap?: Map<number, number>
  update: (k: keyof CoachingFormState, v: any) => void
}

export function RequiredActionsSection({ form, errors, resources, quizzes, topicIdMap = new Map(), update }: S3Props) {
  const [kbSearch,   setKbSearch]   = useState('')
  const [quizSearch, setQuizSearch] = useState('')

  const topicFKSet = new Set(
    form.topic_ids.map(lid => topicIdMap.get(lid)).filter((x): x is number => x !== undefined)
  )
  const filteredResources = resources.filter(r =>
    topicFKSet.size === 0 || r.topic_ids.some(tid => topicFKSet.has(tid))
  )
  const filteredQuizzes = quizzes.filter(q =>
    topicFKSet.size === 0 || q.topic_ids.some(tid => topicFKSet.has(tid))
  )

  const resourceItems = filteredResources.map(r => ({
    id: r.id, label: `${r.title} — ${r.resource_type}`, topics: r.topic_ids,
  }))
  const quizItems = filteredQuizzes.map(q => ({
    id: q.id, label: `${q.quiz_title} — ${q.question_count}Q · Pass: ${q.pass_score}%`, topics: q.topic_ids,
  }))

  const toggleResource = (id: number) => update('kb_resource_ids', form.kb_resource_ids.includes(id)
    ? form.kb_resource_ids.filter(x => x !== id) : [...form.kb_resource_ids, id])
  const toggleQuiz = (id: number) => update('quiz_ids', form.quiz_ids.includes(id)
    ? form.quiz_ids.filter(x => x !== id) : [...form.quiz_ids, id])

  return (
    <FormSection title="Required Actions">
      <Field label="Required Action">
        <Textarea
          rows={3} maxLength={1000} value={form.required_action}
          placeholder="Describe what must change or improve…"
          onChange={e => update('required_action', e.target.value)}
        />
        <p className="text-[11px] text-slate-400 mt-1">
          {form.required_action.length}/1000 · Shown prominently to the CSR as what must change.
        </p>
      </Field>

      <SubSection title="Reference Materials">
        <AssignmentMultiSelect
          items={resourceItems} selectedIds={form.kb_resource_ids} onToggle={toggleResource}
          placeholder="Assign Reference Materials…" noTopicsMsg="No resources linked to the selected topics."
          search={kbSearch} setSearch={setKbSearch}
        />
      </SubSection>

      <SubSection title="Quiz Assignment">
        <AssignmentMultiSelect
          items={quizItems} selectedIds={form.quiz_ids} onToggle={toggleQuiz}
          placeholder="Assign quizzes…" noTopicsMsg="No quizzes linked to the selected topics."
          search={quizSearch} setSearch={setQuizSearch}
        />
      </SubSection>
    </FormSection>
  )
}

// ── Section 4: CSR Accountability ────────────────────────────────────────────

interface S4Props {
  form: CoachingFormState
  errors: CoachingFormErrors
  update: (k: keyof CoachingFormState, v: any) => void
}

export function AccountabilitySection({ form, errors, update }: S4Props) {
  return (
    <FormSection title="CSR Accountability">
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

      <SubSection title="Timing">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Due Date">
            <Input type="date" value={form.due_date} onChange={e => update('due_date', e.target.value)} />
          </Field>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={form.follow_up_required} onCheckedChange={v => update('follow_up_required', v)} />
            <span className="text-[13px] text-slate-700">Follow-Up Required</span>
          </div>
          {form.follow_up_required && (
            <Field label="Follow-Up Date" error={errors.follow_up_date}>
              <Input type="date" value={form.follow_up_date} onChange={e => update('follow_up_date', e.target.value)} />
            </Field>
          )}
        </div>
        {form.follow_up_required && (
          <div className="mt-4">
            <Field label="Follow-Up Notes">
              <Textarea
                rows={4} maxLength={3000} value={form.follow_up_notes}
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

// ── Dynamic behavior flag multi-select ───────────────────────────────────────

function BehaviorFlagSelect({ flagItems, selectedIds, onToggle }: {
  flagItems: ListItem[]; selectedIds: number[]; onToggle: (id: number) => void
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')

  const selectedItems = flagItems.filter(f => selectedIds.includes(f.id))
  const label = selectedItems.length === 0
    ? 'Select behavior flags…'
    : `${selectedItems.length} flag${selectedItems.length !== 1 ? 's' : ''} selected`

  const categories = [...new Set(flagItems.map(f => f.category ?? 'Other'))]

  return (
    <div>
      <DropdownMenu open={open} onOpenChange={o => { setOpen(o); if (o) setSearch('') }}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between font-normal text-[13px] h-9">
            <span className={selectedItems.length === 0 ? 'text-slate-400' : 'text-slate-700'}>{label}</span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[380px] p-0" onCloseAutoFocus={e => e.preventDefault()}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <Input
              className="flex-1 border-0 h-7 text-[13px] focus-visible:ring-0 px-0 placeholder:text-slate-400"
              placeholder="Search flags…" value={search}
              onChange={e => setSearch(e.target.value)} onKeyDown={e => e.stopPropagation()} />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {categories.map((cat, ci) => {
              const items = flagItems.filter(f =>
                (f.category ?? 'Other') === cat &&
                (!search || f.label.toLowerCase().includes(search.toLowerCase()))
              )
              if (!items.length) return null
              return (
                <DropdownMenuGroup key={cat}>
                  {ci > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                    {cat}
                  </DropdownMenuLabel>
                  {items.map(f => (
                    <DropdownMenuCheckboxItem key={f.id} checked={selectedIds.includes(f.id)}
                      onCheckedChange={() => onToggle(f.id)} onSelect={e => e.preventDefault()}>
                      {f.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              )
            })}
            {flagItems.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-400 italic">No behavior flags configured</p>
            )}
          </div>
          {selectedItems.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <p className="text-[11px] text-primary font-medium">{selectedItems.length} selected</p>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedItems.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedItems.map(f => (
            <span key={f.id}
              className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-700 text-[13px] rounded-md border border-slate-200">
              {f.label}
              <ChipRemove onClick={() => onToggle(f.id)} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Section 5: Internal Notes ─────────────────────────────────────────────────

interface S5InternalProps {
  form: CoachingFormState
  flagItems: ListItem[]
  update: (k: keyof CoachingFormState, v: any) => void
}

export function InternalNotesSection({ form, flagItems, update }: S5InternalProps) {
  const selectedIds = form.behavior_flag_ids ?? []
  const toggleFlag = (id: number) => update('behavior_flag_ids',
    selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">Internal Notes</h3>
        <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">Private — Not visible to CSR</span>
      </div>
      <div className="p-5 space-y-4">
        <Field label="Behavior Flags">
          <BehaviorFlagSelect flagItems={flagItems} selectedIds={selectedIds} onToggle={toggleFlag} />
        </Field>
        <Field label="Internal Notes">
          <Textarea
            rows={4} maxLength={3000} value={form.internal_notes}
            placeholder="Context, observations, concerns…"
            onChange={e => update('internal_notes', e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mt-1 text-right">{form.internal_notes.length}/3000</p>
        </Field>
      </div>
    </div>
  )
}

// ── Section 6: Attachment (optional) ─────────────────────────────────────────

interface AttachmentProps {
  form: CoachingFormState; update: (k: keyof CoachingFormState, v: any) => void
  existingFilename?: string; onRemoveExisting: () => void
}

export function AttachmentSection({ form, update, existingFilename, onRemoveExisting }: AttachmentProps) {
  const [expanded, setExpanded] = useState(!!(existingFilename || form.attachment_file))

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Button type="button" variant="ghost"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-5 py-4 justify-start h-auto rounded-none hover:bg-slate-50">
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
      </Button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4">
          {existingFilename && (
            <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg mb-3">
              <span className="text-[13px] text-slate-700 truncate">{existingFilename}</span>
              <Button type="button" variant="ghost" size="sm"
                className="text-[12px] text-red-500 hover:text-red-700 ml-3 shrink-0 h-auto"
                onClick={onRemoveExisting}>
                Remove
              </Button>
            </div>
          )}
          <Input
            type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            className="text-[13px] text-slate-600 file:mr-3 file:py-1 file:px-3 file:border-0 file:rounded file:bg-primary/10 file:text-primary file:text-[12px] file:cursor-pointer"
            onChange={e => update('attachment_file', e.target.files?.[0] ?? null)}
          />
          <p className="text-[11px] text-slate-400 mt-1">Max 10 MB · PDF, Word, Images</p>
        </div>
      )}
    </div>
  )
}
