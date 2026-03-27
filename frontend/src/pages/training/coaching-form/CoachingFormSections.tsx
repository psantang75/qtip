/**
 * Reusable section components for CoachingSessionFormPage.
 * Keeps the main page file focused on state / logic.
 */
import { Switch } from '@/components/ui/switch'
import type { CoachingPurpose, CoachingFormat, CoachingSourceType, TrainingResource, LibraryQuiz } from '@/services/trainingService'
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

export function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
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

const NOTES_PLACEHOLDER: Record<CoachingPurpose, string> = {
  WEEKLY:      'Summarize performance trends, strengths, and focus areas...',
  PERFORMANCE: 'Describe the specific gap or pattern being addressed...',
  ONBOARDING:  'Describe the onboarding topic and key points covered...',
}

// ── Section 1: Session Info ───────────────────────────────────────────────────

interface S1Props {
  form: CoachingFormState; errors: CoachingFormErrors
  csrs: { id: number; name: string; department: string }[]
  currentUserName: string
  update: (k: keyof CoachingFormState, v: any) => void
}

export function SessionInfoSection({ form, errors, csrs, currentUserName, update }: S1Props) {
  return (
    <FormSection title="Session Info">
      <div className="grid grid-cols-2 gap-4">
        <Field label="CSR" required error={errors.csr_id}>
          <select className={sel} value={form.csr_id || ''} onChange={e => update('csr_id', Number(e.target.value))}>
            <option value="">Select CSR…</option>
            {csrs.map(c => <option key={c.id} value={c.id}>{c.name} — {c.department}</option>)}
          </select>
        </Field>
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
        <Field label="Coaching Format" required error={errors.coaching_format}>
          <select className={sel} value={form.coaching_format} onChange={e => update('coaching_format', e.target.value as CoachingFormat)}>
            <option value="">Select format…</option>
            <option value="ONE_ON_ONE">1-on-1</option>
            <option value="SIDE_BY_SIDE">Side-by-Side</option>
            <option value="TEAM_SESSION">Team Session</option>
          </select>
        </Field>
        <div>
          <p className="text-[13px] font-medium text-slate-700 mb-1">Coach</p>
          <p className="text-[13px] text-slate-600 h-9 flex items-center">{currentUserName}</p>
        </div>
      </div>
    </FormSection>
  )
}

// ── Section 2: Context ────────────────────────────────────────────────────────

interface S2Props { form: CoachingFormState; errors: CoachingFormErrors; update: (k: keyof CoachingFormState, v: any) => void }

export function ContextSection({ form, errors, update }: S2Props) {
  return (
    <FormSection title="Context">
      <div className="space-y-4">
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
        <Field label="Notes" required error={errors.notes}>
          <textarea className={tex} rows={5} maxLength={3000} value={form.notes}
            placeholder={form.coaching_purpose ? NOTES_PLACEHOLDER[form.coaching_purpose as CoachingPurpose] : 'Enter session notes…'}
            onChange={e => update('notes', e.target.value)} />
          <p className="text-[11px] text-slate-400 mt-1 text-right">{form.notes.length}/3000</p>
        </Field>
      </div>
    </FormSection>
  )
}

// ── Section 3: Topics ─────────────────────────────────────────────────────────

interface S3Props { form: CoachingFormState; errors: CoachingFormErrors; topics: Topic[]; toggle: (id: number) => void }

export function TopicsSection({ form, errors, topics, toggle }: S3Props) {
  return (
    <FormSection title="Topics">
      {errors.topic_ids && <p className="text-[12px] text-red-600 mb-3">{errors.topic_ids}</p>}
      <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
        {topics.map(t => (
          <label key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" className="rounded border-slate-300 text-primary"
              checked={form.topic_ids.includes(t.id)} onChange={() => toggle(t.id)} />
            <span className="text-[13px] text-slate-700">{t.topic_name}</span>
          </label>
        ))}
      </div>
      {form.topic_ids.length > 0 && (
        <p className="text-[12px] text-primary mt-2">{form.topic_ids.length} topic{form.topic_ids.length !== 1 ? 's' : ''} selected</p>
      )}
    </FormSection>
  )
}

// ── Section 4: Required Action ────────────────────────────────────────────────

interface S4Props { form: CoachingFormState; update: (k: keyof CoachingFormState, v: any) => void }

export function RequiredActionSection({ form, update }: S4Props) {
  return (
    <FormSection title="Required Action">
      <textarea className={tex} rows={3} maxLength={1000} value={form.required_action}
        placeholder="Describe what must change or improve…"
        onChange={e => update('required_action', e.target.value)} />
      <p className="text-[11px] text-slate-400 mt-1">{form.required_action.length}/1000 · This is shown prominently to the CSR as what must change.</p>
    </FormSection>
  )
}

// ── Section 5: KB Resource ────────────────────────────────────────────────────

interface S5Props {
  form: CoachingFormState; update: (k: keyof CoachingFormState, v: any) => void
  resources: TrainingResource[]
}

export function KBResourceSection({ form, update, resources }: S5Props) {
  const selectedResource = resources.find(r => r.id === form.kb_resource_id)
  return (
    <FormSection title="Knowledge Base Resource (optional)">
      <div className="flex gap-4 mb-4">
        {(['library', 'custom'] as const).map(mode => (
          <label key={mode} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="kb_mode" checked={form.kb_mode === mode} onChange={() => update('kb_mode', mode)} />
            <span className="text-[13px] text-slate-700">{mode === 'library' ? 'From Library' : 'Custom URL'}</span>
          </label>
        ))}
      </div>
      {form.kb_mode === 'library' ? (
        <div className="space-y-2">
          <select className={sel} value={form.kb_resource_id || ''}
            onChange={e => update('kb_resource_id', Number(e.target.value) || 0)}>
            <option value="">No resource selected</option>
            {resources.map(r => <option key={r.id} value={r.id}>{r.title}{r.topic_name ? ` — ${r.topic_name}` : ''}</option>)}
          </select>
          {selectedResource && (
            <div className="p-3 bg-blue-50 rounded-lg text-[12px] text-slate-600 space-y-1">
              {selectedResource.description && <p>{selectedResource.description}</p>}
              <a href={selectedResource.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Preview ↗</a>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <input className={inp} placeholder="URL" value={form.kb_url} onChange={e => update('kb_url', e.target.value)} />
          <input className={inp} placeholder="Label (optional)" value={form.kb_label} onChange={e => update('kb_label', e.target.value)} />
        </div>
      )}
    </FormSection>
  )
}

// ── Section 6: Quiz ───────────────────────────────────────────────────────────

interface S6Props {
  form: CoachingFormState; errors: CoachingFormErrors; update: (k: keyof CoachingFormState, v: any) => void
  quizzes: LibraryQuiz[]
}

export function QuizSection({ form, errors, update, quizzes }: S6Props) {
  return (
    <FormSection title="Quiz">
      <div className="flex items-center gap-3 mb-4">
        <Switch checked={form.quiz_required} onCheckedChange={v => update('quiz_required', v)} />
        <span className="text-[13px] text-slate-700">Quiz Required</span>
      </div>
      {form.quiz_required && (
        <Field label="Select Quiz" error={errors.quiz_id}>
          <select className={sel} value={form.quiz_id || ''} onChange={e => update('quiz_id', Number(e.target.value) || 0)}>
            <option value="">Select quiz…</option>
            {quizzes.map(q => (
              <option key={q.id} value={q.id}>
                {q.quiz_title} — {q.question_count}Q · Pass: {q.pass_score}%
              </option>
            ))}
          </select>
        </Field>
      )}
    </FormSection>
  )
}

// ── Section 7: Accountability ─────────────────────────────────────────────────

interface S7Props { form: CoachingFormState; update: (k: keyof CoachingFormState, v: any) => void }

export function AccountabilitySection({ form, update }: S7Props) {
  return (
    <FormSection title="CSR Accountability">
      <div className="space-y-4">
        {([
          ['require_action_plan',    'Require Action Plan',    'CSR must write a response before completing'],
          ['require_acknowledgment', 'Require Acknowledgment', 'CSR must check acknowledgment box'],
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
    </FormSection>
  )
}

// ── Section 8: Timing ─────────────────────────────────────────────────────────

interface S8Props { form: CoachingFormState; errors: CoachingFormErrors; update: (k: keyof CoachingFormState, v: any) => void }

export function TimingSection({ form, errors, update }: S8Props) {
  return (
    <FormSection title="Timing">
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
    </FormSection>
  )
}

// ── Section 9: Attachment ─────────────────────────────────────────────────────

interface S9Props {
  form: CoachingFormState; update: (k: keyof CoachingFormState, v: any) => void
  existingFilename?: string; onRemoveExisting: () => void
}

export function AttachmentSection({ form, update, existingFilename, onRemoveExisting }: S9Props) {
  return (
    <FormSection title="Attachment (optional)">
      {existingFilename && (
        <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg mb-3">
          <span className="text-[13px] text-slate-700 truncate">{existingFilename}</span>
          <button type="button" onClick={onRemoveExisting} className="text-[12px] text-red-500 hover:text-red-700 ml-3 shrink-0">Remove</button>
        </div>
      )}
      <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        className="w-full text-[13px] text-slate-600 file:mr-3 file:py-1 file:px-3 file:border-0 file:rounded file:bg-primary/10 file:text-primary file:text-[12px] file:cursor-pointer"
        onChange={e => update('attachment_file', e.target.files?.[0] ?? null)} />
      <p className="text-[11px] text-slate-400 mt-1">Max 10 MB · PDF, Word, Images</p>
    </FormSection>
  )
}
