import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import trainingService from '@/services/trainingService'
import topicService from '@/services/topicService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatQualityDate } from '@/utils/dateFormat'
import {
  SessionSection, RequiredActionsSection, AttachmentSection,
} from './coaching-form/CoachingFormSections'
import { emptyForm, type CoachingFormState, type CoachingFormErrors } from './coaching-form/types'

export default function CoachingSessionFormPage() {
  const navigate   = useNavigate()
  const { id }     = useParams<{ id: string }>()
  const isEdit     = !!id
  const { user }   = useAuth()
  const { toast }  = useToast()
  const qc         = useQueryClient()

  const [form, setForm]                       = useState<CoachingFormState>(emptyForm)
  const [errors, setErrors]                   = useState<CoachingFormErrors>({})
  const [saving, setSaving]                   = useState(false)
  const [existingFilename, setExistingFilename] = useState<string | undefined>()
  const [showAllHistory, setShowAllHistory]   = useState(false)

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
    queryFn:  () => trainingService.getCoachingSessionDetail(Number(id)),
    enabled:  isEdit,
    staleTime: 0,
  })

  const { data: csrs = [] }     = useQuery({ queryKey: ['team-csrs'],    queryFn: () => trainingService.getTeamCSRs() })
  const { data: coaches = [] }  = useQuery({ queryKey: ['eligible-coaches'], queryFn: () => trainingService.getCoaches() })
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

  // ── Default coach to current user on new session ────────────────────────────

  useEffect(() => {
    if (!isEdit && user?.id) {
      setForm(f => f.coach_id === 0 ? { ...f, coach_id: user.id } : f)
    }
  }, [isEdit, user?.id])

  // ── Populate form on edit ───────────────────────────────────────────────────

  useEffect(() => {
    if (!existing) return
    const s = existing
    setForm({
      csr_id:               s.csr_id,
      coach_id:             s.created_by   ?? user?.id ?? 0,
      session_date:         s.session_date?.slice(0, 16) ?? new Date().toISOString().slice(0, 16),
      coaching_purpose:     s.coaching_purpose,
      coaching_format:      s.coaching_format,
      source_type:          s.source_type,
      notes:                s.notes ?? '',
      topic_ids:            s.topic_ids ?? [],
      required_action:      s.required_action ?? '',
      kb_resource_ids:      (s.kb_resources ?? []).map((r: any) => r.id),
      quiz_ids:             (s.quizzes ?? []).map((q: any) => q.id),
      require_acknowledgment: s.require_acknowledgment !== undefined ? !!s.require_acknowledgment : true,
      require_action_plan:    s.require_action_plan    !== undefined ? !!s.require_action_plan    : true,
      due_date:               s.due_date?.slice(0, 10)       ?? '',
      follow_up_required:     !!s.follow_up_required,
      follow_up_date:         s.follow_up_date?.slice(0, 10) ?? '',
      attachment_file:      null,
    })
    setExistingFilename(s.attachment_filename ?? undefined)
  }, [existing])

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: CoachingFormErrors = {}
    if (!form.csr_id)          e.csr_id         = 'Select a CSR'
    if (!form.session_date)    e.session_date    = 'Date is required'
    if (!form.coaching_purpose) e.coaching_purpose = 'Select a coaching purpose'
    if (!form.coaching_format)  e.coaching_format  = 'Select a coaching format'
    if (!form.source_type)     e.source_type     = 'Select a source'
    if (!form.notes.trim())    e.notes           = 'Notes are required'
    if (!form.topic_ids.length) e.topic_ids      = 'Select at least one topic'
    if (form.quiz_required && !form.quiz_id) e.quiz_id = 'Select a quiz'
    if (form.follow_up_required && !form.follow_up_date) e.follow_up_date = 'Follow-up date is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async (saveStatus: 'SCHEDULED' | 'IN_PROCESS' | 'COMPLETED') => {
    if (!validate()) return
    if (saveStatus === 'COMPLETED') {
      toast({ title: 'Saving as Completed…', description: 'Marking this session complete.' })
      await new Promise(r => setTimeout(r, 1000))
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('csr_id',               String(form.csr_id))
      fd.append('coach_id',             String(form.coach_id || user?.id || ''))
      fd.append('session_date',         form.session_date)
      fd.append('coaching_purpose',     form.coaching_purpose)
      fd.append('coaching_format',      form.coaching_format)
      fd.append('source_type',          form.source_type)
      fd.append('notes',                form.notes)
      fd.append('topic_ids',            form.topic_ids.join(','))
      fd.append('status',               saveStatus)
      fd.append('required_action',        form.required_action)
      fd.append('resource_ids',           form.kb_resource_ids.join(','))
      fd.append('quiz_ids',               form.quiz_ids.join(','))
      fd.append('require_acknowledgment', String(form.require_acknowledgment))
      fd.append('require_action_plan',    String(form.require_action_plan))
      fd.append('follow_up_required',     String(form.follow_up_required))
      fd.append('due_date',       form.due_date       || '')
      fd.append('follow_up_date', form.follow_up_date || '')
      if (form.attachment_file)  fd.append('attachment',      form.attachment_file)

      if (isEdit) {
        await trainingService.updateCoachingSession(Number(id), fd)
        qc.invalidateQueries({ queryKey: ['coaching-session', id] })
        qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
        toast({ title: 'Session updated' })
      } else {
        await trainingService.createCoachingSession(fd)
        qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
        toast({ title: 'Session created' })
      }
      navigate('/app/training/coaching')
    } catch (err: any) {
      toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const sessions = history?.sessions ?? []

  return (
    <QualityListPage>
      <QualityPageHeader
        title={isEdit ? 'Edit Coaching Session' : 'New Coaching Session'}
        actions={<Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>}
      />

      <div className="grid grid-cols-3 gap-6">

        {/* ── Main Form ─────────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          <SessionSection
            form={form} errors={errors} csrs={csrs}
            coaches={coaches} topics={topics}
            update={update} toggleTopic={toggleTopic}
          />
          <RequiredActionsSection
            form={form} errors={errors} resources={resources}
            quizzes={quizzes} update={update}
          />
          <AttachmentSection
            form={form} update={update}
            existingFilename={existingFilename}
            onRemoveExisting={() => setExistingFilename(undefined)}
          />
        </div>

        {/* ── CSR History Panel ─────────────────────────────────────────── */}
        <div className="col-span-1">
          <div className="bg-white rounded-xl border border-slate-200 p-4 sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Recent Coaching</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Topics within the last 90 days</p>
              </div>
              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory(true)}
                  className="text-[12px] text-primary hover:underline"
                >
                  View all →
                </button>
              )}
            </div>

            {!csrId ? (
              <p className="text-[13px] text-slate-400">Select a CSR to see history</p>
            ) : historyLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-[13px] text-slate-400">No prior sessions</p>
            ) : (
              <>
                <div className="space-y-0">
                  {sessions.slice(0, 5).map(s => (
                    <div key={s.id} className="grid grid-cols-[90px_1fr] gap-6 py-3 border-b border-slate-100 last:border-0 items-start">
                      <span className="text-[11px] text-slate-400 pt-0.5 whitespace-nowrap">
                        {formatQualityDate(s.session_date)}
                      </span>
                      <div>
                        {s.topics.length > 0 ? (
                          <ul className="space-y-1">
                            {s.topics.map(t => (
                              <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                {t}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-[13px] text-slate-400">No topics</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {(history?.repeat_topics?.length ?? 0) > 0 && (
                  <div className="mt-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Coached 2+ times in 90 days</p>
                    <ul className="space-y-1 pl-3">
                      {history!.repeat_topics!.map(t => (
                        <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      {/* ── Bottom Action Bar ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between mt-2">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={saving}>Cancel</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleSave('SCHEDULED')} disabled={saving}>
            Save as Scheduled
          </Button>
          <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50"
            onClick={() => handleSave('IN_PROCESS')} disabled={saving}>
            Save as In Process
          </Button>
          <Button className="bg-primary hover:bg-primary/90 text-white"
            onClick={() => handleSave('COMPLETED')} disabled={saving}>
            {saving ? 'Saving…' : 'Save as Completed'}
          </Button>
        </div>
      </div>

      {/* ── View All History Modal ─────────────────────────────────────────── */}
      <Dialog open={showAllHistory} onOpenChange={setShowAllHistory}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>All Coaching History</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 pr-1">
            {sessions.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-4 text-center">No prior sessions</p>
            ) : (
              <div className="space-y-0">
                {sessions.map(s => (
                  <div key={s.id} className="grid grid-cols-[90px_1fr] gap-2 py-3 border-b border-slate-100 last:border-0 items-start">
                    <span className="text-[11px] text-slate-400 pt-0.5 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </span>
                    <div>
                      {s.topics.length > 0 ? (
                        <ul className="space-y-0.5">
                          {s.topics.map(t => (
                            <li key={t} className="flex items-center gap-1.5 text-[12px] text-slate-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                              {t}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[12px] text-slate-400">No topics</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}
