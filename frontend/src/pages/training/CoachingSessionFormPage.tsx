import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import trainingService from '@/services/trainingService'
import listService from '@/services/listService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatQualityDate } from '@/utils/dateFormat'
import {
  SessionSection, RequiredActionsSection, AccountabilitySection, InternalNotesSection, AttachmentSection,
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
  const { data: topicItems = [] }   = useQuery({ queryKey: ['list-items', 'training_topic'],   queryFn: () => listService.getItems('training_topic') })
  const { data: resourcesData }     = useQuery({ queryKey: ['resources'],                       queryFn: () => trainingService.getResources({ is_active: true, limit: 200 }) })
  const { data: quizLibrary }       = useQuery({ queryKey: ['quiz-library'],                    queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })
  const { data: flagItems = [] }    = useQuery({ queryKey: ['list-items', 'behavior_flag'],    queryFn: () => listService.getItems('behavior_flag') })
  const { data: purposeItems = [] } = useQuery({ queryKey: ['list-items', 'coaching_purpose'], queryFn: () => listService.getItems('coaching_purpose') })
  const { data: formatItems = [] }  = useQuery({ queryKey: ['list-items', 'coaching_format'],  queryFn: () => listService.getItems('coaching_format') })
  const { data: sourceItems = [] }  = useQuery({ queryKey: ['list-items', 'coaching_source'],  queryFn: () => listService.getItems('coaching_source') })

  const resources = resourcesData?.items ?? []
  const quizzes   = quizLibrary?.items   ?? []

  // Map list_items.id → topics.id (item_key) for resource/quiz topic filtering
  const topicIdMap = new Map<number, number>(
    topicItems.filter(t => t.item_key).map(t => [t.id, parseInt(t.item_key!)])
  )

  const csrId = form.csr_ids[0] ?? 0
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
      csr_ids:              [s.csr_id],
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
      follow_up_required:     !!s.follow_up_required || !!s.follow_up_date,
      follow_up_date:         s.follow_up_date?.slice(0, 10) ?? '',
      follow_up_notes:        s.follow_up_notes ?? '',
      internal_notes:         s.internal_notes ?? '',
      behavior_flag_ids:      s.behavior_flag_ids ?? [],
      attachment_file:      null,
    })
    setExistingFilename(s.attachment_filename ?? undefined)
  }, [existing])

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: CoachingFormErrors = {}
    if (!form.csr_ids.length)   (e as any).csr_ids = 'Select at least one CSR'
    if (!form.session_date)     e.session_date      = 'Date is required'
    if (!form.coaching_purpose) e.coaching_purpose  = 'Select a coaching purpose'
    if (!form.coaching_format)  e.coaching_format   = 'Select a coaching format'
    if (!form.source_type)      e.source_type       = 'Select a source'
    if (!form.notes.trim())     e.notes             = 'Notes are required'
    if (!form.topic_ids.length) e.topic_ids         = 'Select at least one topic'
    if (form.follow_up_required && !form.follow_up_date) e.follow_up_date = 'Follow-up date is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Build FormData ───────────────────────────────────────────────────────────

  const buildFormData = (): FormData => {
    const fd = new FormData()
    // For edit: send single csr_id; for create: send csr_ids (supports multi)
    if (isEdit) {
      fd.append('csr_id', String(form.csr_ids[0] || ''))
    } else {
      fd.append('csr_ids', form.csr_ids.join(','))
    }
    fd.append('coach_id',               String(form.coach_id || user?.id || ''))
    fd.append('session_date',           form.session_date)
    fd.append('coaching_purpose',       form.coaching_purpose)
    fd.append('coaching_format',        form.coaching_format)
    fd.append('source_type',            form.source_type)
    fd.append('notes',                  form.notes)
    fd.append('topic_ids',              form.topic_ids.join(','))
    fd.append('required_action',        form.required_action)
    fd.append('resource_ids',           form.kb_resource_ids.join(','))
    fd.append('quiz_ids',               form.quiz_ids.join(','))
    fd.append('require_acknowledgment', String(form.require_acknowledgment))
    fd.append('require_action_plan',    String(form.require_action_plan))
    fd.append('follow_up_required',     String(form.follow_up_required))
    fd.append('due_date',               form.due_date         || '')
    fd.append('follow_up_date',         form.follow_up_date   || '')
    fd.append('follow_up_notes',        form.follow_up_notes  || '')
    fd.append('internal_notes',         form.internal_notes          || '')
    fd.append('behavior_flag_ids',      form.behavior_flag_ids.join(','))
    if (form.attachment_file) fd.append('attachment', form.attachment_file)
    return fd
  }

  // ── Save (create as SCHEDULED, or update content without touching status) ───

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      if (isEdit) {
        await trainingService.updateCoachingSession(Number(id), buildFormData())
        qc.invalidateQueries({ queryKey: ['coaching-session', id] })
        qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
        toast({ title: 'Session saved' })
      } else {
        const result = await trainingService.createCoachingSession(buildFormData())
        qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
        const count = result.count ?? 1
        toast({ title: count > 1 ? `${count} draft sessions created` : 'Draft saved' })
      }
      navigate('/app/training/coaching')
    } catch (err: any) {
      toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ── Schedule Session (save as SCHEDULED — CSR sees it as Upcoming) ────────
  // The coach delivers it to the CSR from the detail page after the meeting,
  // at which point the system auto-determines IN_PROCESS vs AWAITING_CSR_ACTION.

  const handleSaveAndDeliver = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      if (isEdit) {
        await trainingService.updateCoachingSession(Number(id), buildFormData())
        qc.invalidateQueries({ queryKey: ['coaching-session', id] })
        qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
        toast({ title: 'Session scheduled — CSR will see it as Upcoming' })
        navigate(`/app/training/coaching/${id}`)
      } else {
        const created = await trainingService.createCoachingSession(buildFormData())
        qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
        if (created.ids && created.ids.length > 1) {
          await Promise.all(created.ids.map((sid: number) => trainingService.deliverSession(sid)))
          toast({ title: `${created.ids.length} sessions scheduled` })
          navigate('/app/training/coaching')
        } else {
          const singleId = created.id ?? created.ids?.[0]
          if (singleId) await trainingService.deliverSession(singleId)
          toast({ title: 'Session scheduled' })
          navigate(singleId ? `/app/training/coaching/${singleId}` : '/app/training/coaching')
        }
      }
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
            coaches={coaches} topicItems={topicItems} isEdit={isEdit}
            purposeItems={purposeItems} formatItems={formatItems} sourceItems={sourceItems}
            update={update} toggleTopic={toggleTopic}
          />
          <RequiredActionsSection
            form={form} errors={errors} resources={resources}
            quizzes={quizzes} topicIdMap={topicIdMap} update={update}
          />
          <AccountabilitySection form={form} errors={errors} update={update} />
          {[1, 4, 5].includes(user?.role_id ?? 0) && (
            <InternalNotesSection form={form} flagItems={flagItems} update={update} />
          )}
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
        <div className="flex items-center gap-3">
          {/* Show both buttons when creating OR editing a draft */}
          {(!isEdit || existing?.status === 'SCHEDULED') ? (
            <>
              <Button variant="outline" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save Draft' : 'Save as Draft'}
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-white"
                onClick={handleSaveAndDeliver}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Schedule Session'}
              </Button>
            </>
          ) : (
            /* Editing a non-draft session — just save content */
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
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
