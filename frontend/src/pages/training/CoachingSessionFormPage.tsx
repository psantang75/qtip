import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import trainingService from '@/services/trainingService'
import topicService from '@/services/topicService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { Button } from '@/components/ui/button'
import { formatQualityDate } from '@/utils/dateFormat'
import { CoachingTypeBadge, TopicChips } from './CoachingSessionsPage'
import {
  SessionInfoSection, ContextSection, TopicsSection, RequiredActionSection,
  KBResourceSection, QuizSection, AccountabilitySection, TimingSection, AttachmentSection,
} from './coaching-form/CoachingFormSections'
import { emptyForm, type CoachingFormState, type CoachingFormErrors } from './coaching-form/types'

export default function CoachingSessionFormPage() {
  const navigate   = useNavigate()
  const { id }     = useParams<{ id: string }>()
  const isEdit     = !!id
  const { user }   = useAuth()
  const { toast }  = useToast()

  const [form, setForm]                       = useState<CoachingFormState>(emptyForm)
  const [errors, setErrors]                   = useState<CoachingFormErrors>({})
  const [saving, setSaving]                   = useState(false)
  const [existingFilename, setExistingFilename] = useState<string | undefined>()

  const update = useCallback(<K extends keyof CoachingFormState>(k: K, v: CoachingFormState[K]) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }, [])

  const toggleTopic = useCallback((topicId: number) => {
    setForm(f => ({
      ...f,
      topic_ids: f.topic_ids.includes(topicId)
        ? f.topic_ids.filter(x => x !== topicId)
        : [...f.topic_ids, topicId],
    }))
    setErrors(e => ({ ...e, topic_ids: undefined }))
  }, [])

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: existing } = useQuery({
    queryKey: ['coaching-session', id],
    queryFn: () => trainingService.getCoachingSessionDetail(Number(id)),
    enabled: isEdit,
  })

  const { data: csrs = [] }     = useQuery({ queryKey: ['team-csrs'],    queryFn: () => trainingService.getTeamCSRs() })
  const { data: topicsData }    = useQuery({ queryKey: ['topics-active'], queryFn: () => topicService.getTopics(1, 200, { is_active: true }) })
  const { data: resourcesData } = useQuery({ queryKey: ['resources'],     queryFn: () => trainingService.getResources({ is_active: true, limit: 200 }) })
  const { data: quizLibrary }   = useQuery({ queryKey: ['quiz-library'],  queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })

  const topics    = topicsData?.items    ?? []
  const resources = resourcesData?.items ?? []
  const quizzes   = quizLibrary?.items   ?? []

  const csrId = form.csr_id
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['csr-coaching-history', csrId],
    queryFn:  () => trainingService.getCSRHistory(csrId),
    enabled:  csrId > 0,
  })

  // ── Populate form on edit ───────────────────────────────────────────────────

  useEffect(() => {
    if (!existing) return
    const s = existing
    setForm({
      csr_id:               s.csr_id,
      session_date:         s.session_date?.slice(0, 16) ?? new Date().toISOString().slice(0, 16),
      coaching_type:        s.coaching_type,
      source_type:          s.source_type,
      notes:                s.notes ?? '',
      topic_ids:            s.topic_ids ?? [],
      required_action:      s.required_action ?? '',
      kb_mode:              s.kb_resource_id ? 'library' : s.kb_url ? 'custom' : 'library',
      kb_resource_id:       s.kb_resource_id ?? 0,
      kb_url:               s.kb_url ?? '',
      kb_label:             '',
      quiz_required:        s.quiz_required ?? false,
      quiz_id:              s.quiz_id ?? 0,
      require_acknowledgment: s.require_acknowledgment ?? true,
      require_action_plan:  s.require_action_plan ?? true,
      due_date:             s.due_date?.slice(0, 10) ?? '',
      follow_up_required:   s.follow_up_required ?? false,
      follow_up_date:       s.follow_up_date?.slice(0, 10) ?? '',
      attachment_file:      null,
    })
    setExistingFilename(s.attachment_filename ?? undefined)
  }, [existing])

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: CoachingFormErrors = {}
    if (!form.csr_id)          e.csr_id         = 'Select a CSR'
    if (!form.session_date)    e.session_date    = 'Date is required'
    if (!form.coaching_type)   e.coaching_type   = 'Select a coaching type'
    if (!form.source_type)     e.source_type     = 'Select a source'
    if (!form.notes.trim())    e.notes           = 'Notes are required'
    if (!form.topic_ids.length) e.topic_ids      = 'Select at least one topic'
    if (form.quiz_required && !form.quiz_id) e.quiz_id = 'Select a quiz'
    if (form.follow_up_required && !form.follow_up_date) e.follow_up_date = 'Follow-up date is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async (saveStatus: 'SCHEDULED' | 'DELIVERED' | 'COMPLETED') => {
    if (!validate()) return
    if (saveStatus === 'COMPLETED') {
      toast({ title: 'Saving as Completed…', description: 'Marking this session complete.' })
      await new Promise(r => setTimeout(r, 1000))
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('csr_id',               String(form.csr_id))
      fd.append('session_date',         form.session_date)
      fd.append('coaching_type',        form.coaching_type)
      fd.append('source_type',          form.source_type)
      fd.append('notes',                form.notes)
      fd.append('topic_ids',            form.topic_ids.join(','))
      fd.append('status',               saveStatus)
      fd.append('required_action',      form.required_action)
      fd.append('quiz_required',        String(form.quiz_required))
      fd.append('require_acknowledgment', String(form.require_acknowledgment))
      fd.append('require_action_plan',  String(form.require_action_plan))
      fd.append('follow_up_required',   String(form.follow_up_required))
      if (form.due_date)         fd.append('due_date',        form.due_date)
      if (form.follow_up_date)   fd.append('follow_up_date',  form.follow_up_date)
      if (form.kb_mode === 'library' && form.kb_resource_id) fd.append('kb_resource_id', String(form.kb_resource_id))
      if (form.kb_mode === 'custom' && form.kb_url)          fd.append('kb_url', form.kb_url)
      if (form.quiz_id)          fd.append('quiz_id',         String(form.quiz_id))
      if (form.attachment_file)  fd.append('attachment',      form.attachment_file)

      if (isEdit) {
        await trainingService.updateCoachingSession(Number(id), fd)
        toast({ title: 'Session updated' })
      } else {
        await trainingService.createCoachingSession(fd)
        toast({ title: 'Session created' })
      }
      navigate('/app/training/coaching')
    } catch (err: any) {
      toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const currentUserName = user?.username ?? 'You'

  return (
    <QualityListPage>
      <QualityPageHeader
        title={isEdit ? 'Edit Coaching Session' : 'New Coaching Session'}
        actions={<Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>}
      />

      <div className="grid grid-cols-3 gap-6">

        {/* ── Main Form ─────────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          <SessionInfoSection form={form} errors={errors} csrs={csrs} currentUserName={currentUserName} update={update} />
          <ContextSection     form={form} errors={errors} update={update} />
          <TopicsSection      form={form} errors={errors} topics={topics} toggle={toggleTopic} />
          <RequiredActionSection form={form} update={update} />
          <KBResourceSection  form={form} update={update} resources={resources} />
          <QuizSection        form={form} errors={errors} update={update} quizzes={quizzes} />
          <AccountabilitySection form={form} update={update} />
          <TimingSection      form={form} errors={errors} update={update} />
          <AttachmentSection  form={form} update={update} existingFilename={existingFilename} onRemoveExisting={() => setExistingFilename(undefined)} />
        </div>

        {/* ── CSR History Panel ─────────────────────────────────────────── */}
        <div className="col-span-1">
          <div className="bg-white rounded-xl border border-slate-200 p-4 sticky top-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Coaching</h3>
            {!csrId ? (
              <p className="text-[13px] text-slate-400">Select a CSR to see history</p>
            ) : historyLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 animate-pulse rounded" />)}
              </div>
            ) : !history?.sessions.length ? (
              <p className="text-[13px] text-slate-400">No prior sessions</p>
            ) : (
              <>
                {history.sessions.map(s => (
                  <div key={s.id} className="py-2 border-b border-slate-100 last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] text-slate-500">{formatQualityDate(s.session_date)}</span>
                      <CoachingTypeBadge type={s.coaching_type} />
                    </div>
                    <TopicChips topics={s.topics} max={3} />
                  </div>
                ))}
                {(history.repeat_topics?.length ?? 0) > 0 && (
                  <div className="mt-3 p-2 bg-orange-50 rounded-lg border border-orange-100">
                    <p className="text-[11px] font-semibold text-orange-700">
                      🔥 Repeat: {history.repeat_topics!.join(', ')}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      {/* ── Sticky Bottom Action Bar ───────────────────────────────────────── */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 flex items-center justify-between mt-6 -mx-6 px-6">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={saving}>Cancel</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleSave('SCHEDULED')} disabled={saving}>
            Save as Scheduled
          </Button>
          <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50"
            onClick={() => handleSave('DELIVERED')} disabled={saving}>
            Save as Delivered
          </Button>
          <Button className="bg-primary hover:bg-primary/90 text-white"
            onClick={() => handleSave('COMPLETED')} disabled={saving}>
            {saving ? 'Saving…' : 'Save as Completed'}
          </Button>
        </div>
      </div>
    </QualityListPage>
  )
}
