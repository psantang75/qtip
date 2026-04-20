import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, type FieldError } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_IDS } from '@/hooks/useQualityRole'
import { useToast } from '@/hooks/use-toast'
import trainingService from '@/services/trainingService'
import listService from '@/services/listService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import {
  SessionSection, RequiredActionsSection, AccountabilitySection, InternalNotesSection,
} from './coaching-form/CoachingFormSections'
import { AgentHistoryPanel } from './coaching-form/AgentHistoryPanel'
import { AttachmentCard } from '@/components/training/AttachmentCard'
import { emptyForm, type CoachingFormState, type CoachingFormErrors } from './coaching-form/types'

export default function CoachingSessionFormPage() {
  const navigate   = useNavigate()
  const { id }     = useParams<{ id: string }>()
  const isEdit     = !!id
  const { user }   = useAuth()
  const { toast }  = useToast()
  const qc         = useQueryClient()

  const [existingFilename, setExistingFilename] = useState<string | undefined>()
  const [removeAttachment, setRemoveAttachment] = useState(false)

  // ── React Hook Form ─────────────────────────────────────────────────────────
  const {
    setValue, watch, reset, getValues, setError, clearErrors,
    formState: { errors: rhfErrors },
  } = useForm<CoachingFormState>({ defaultValues: emptyForm() })

  const form = watch()

  // Convert RHF errors to the flat string map that child sections expect
  const errors: CoachingFormErrors = Object.fromEntries(
    Object.entries(rhfErrors).map(([k, v]) => [k, (v as FieldError | undefined)?.message])
  ) as CoachingFormErrors

  const update = useCallback(<K extends keyof CoachingFormState>(k: K, v: CoachingFormState[K]) => {
    setValue(k, v)
    clearErrors(k)
  }, [setValue, clearErrors])

  const toggleTopic = useCallback((topicId: number) => {
    const current = getValues('topic_ids')
    setValue('topic_ids', current.includes(topicId)
      ? current.filter(x => x !== topicId)
      : [...current, topicId]
    )
    clearErrors('topic_ids')
  }, [getValues, setValue, clearErrors])

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: existing, isError: existingError, refetch: existingRefetch } = useQuery({
    queryKey: ['coaching-session', id],
    queryFn:  () => trainingService.getCoachingSessionDetail(Number(id)),
    enabled:  isEdit,
    staleTime: 0,
  })

  const { data: agents = [] }       = useQuery({ queryKey: ['team-agents'],         queryFn: () => trainingService.getTeamCSRs() })
  const { data: coaches = [] }      = useQuery({ queryKey: ['eligible-coaches'],     queryFn: () => trainingService.getCoaches() })
  const { data: topicItems = [] }   = useQuery({ queryKey: ['list-items', 'training_topic'],   queryFn: () => listService.getItems('training_topic') })
  const { data: resourcesData }     = useQuery({ queryKey: ['resources'],            queryFn: () => trainingService.getResources({ is_active: true, limit: 200 }) })
  const { data: quizLibrary }       = useQuery({ queryKey: ['quiz-library'],         queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })
  const { data: flagItems = [] }           = useQuery({ queryKey: ['list-items', 'behavior_flag'],    queryFn: () => listService.getItems('behavior_flag') })
  const { data: rootCauseItems = [] }     = useQuery({ queryKey: ['list-items', 'root_cause'],       queryFn: () => listService.getItems('root_cause') })
  const { data: supportNeededItems = [] } = useQuery({ queryKey: ['list-items', 'support_needed'],    queryFn: () => listService.getItems('support_needed') })
  const { data: purposeItems = [] }       = useQuery({ queryKey: ['list-items', 'coaching_purpose'], queryFn: () => listService.getItems('coaching_purpose') })
  const { data: formatItems = [] }        = useQuery({ queryKey: ['list-items', 'coaching_format'],  queryFn: () => listService.getItems('coaching_format') })
  const { data: sourceItems = [] }        = useQuery({ queryKey: ['list-items', 'coaching_source'],  queryFn: () => listService.getItems('coaching_source') })

  const resources = resourcesData?.items ?? []
  const quizzes   = quizLibrary?.items   ?? []

  const agentId = form.csr_ids[0] ?? 0
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['agent-coaching-history', agentId],
    queryFn:  () => trainingService.getCSRHistory(agentId),
    enabled:  agentId > 0,
  })

  // ── Default coach to current user on new session ────────────────────────────

  useEffect(() => {
    if (!isEdit && user?.id && getValues('coach_id') === 0) {
      setValue('coach_id', user.id)
    }
  }, [isEdit, user?.id, getValues, setValue])

  // ── Populate form on edit ───────────────────────────────────────────────────

  useEffect(() => {
    if (!existing) return
    const s = existing
    reset({
      csr_ids:               [s.csr_id],
      coach_id:              s.created_by   ?? user?.id ?? 0,
      session_date:          s.session_date?.slice(0, 16) ?? new Date().toISOString().slice(0, 16),
      coaching_purpose:      s.coaching_purpose,
      coaching_format:       s.coaching_format,
      source_type:           s.source_type,
      notes:                 s.notes ?? '',
      topic_ids:             s.topic_ids ?? [],
      required_action:       s.required_action ?? '',
      kb_resource_ids:       (s.kb_resources ?? []).map(r => r.id),
      quiz_ids:              (s.quizzes ?? []).map(q => q.id),
      require_acknowledgment: s.require_acknowledgment !== undefined ? !!s.require_acknowledgment : true,
      require_action_plan:    s.require_action_plan    !== undefined ? !!s.require_action_plan    : true,
      due_date:               s.due_date?.slice(0, 10)       ?? '',
      follow_up_required:     !!s.follow_up_required || !!s.follow_up_date,
      follow_up_date:         s.follow_up_date?.slice(0, 10) ?? '',
      follow_up_notes:        s.follow_up_notes ?? '',
      internal_notes:         s.internal_notes ?? '',
      behavior_flag_ids:      s.behavior_flag_ids ?? [],
      root_cause_ids:         s.root_cause_ids ?? [],
      support_needed_ids:     s.support_needed_ids ?? [],
      attachment_file:        null,
    })
    setExistingFilename(s.attachment_filename ?? undefined)
  }, [existing, reset])

  // ── Validation ──────────────────────────────────────────────────────────────

  const runValidation = (): boolean => {
    clearErrors()
    const f = getValues()
    const issues: { field: keyof CoachingFormState; message: string }[] = []
    if (!f.csr_ids.length)   issues.push({ field: 'csr_ids',          message: 'Select at least one Agent' })
    if (!f.session_date)     issues.push({ field: 'session_date',      message: 'Date is required' })
    if (!f.coaching_purpose) issues.push({ field: 'coaching_purpose',  message: 'Select a coaching purpose' })
    if (!f.coaching_format)  issues.push({ field: 'coaching_format',   message: 'Select a coaching format' })
    if (!f.source_type)      issues.push({ field: 'source_type',       message: 'Select a source' })
    if (!f.notes.trim())     issues.push({ field: 'notes',             message: 'Notes are required' })
    if (!f.topic_ids.length) issues.push({ field: 'topic_ids',         message: 'Select at least one topic' })
    if (f.follow_up_required && !f.follow_up_date)
      issues.push({ field: 'follow_up_date', message: 'Follow-up date is required' })
    issues.forEach(({ field, message }) => setError(field, { message }))
    return issues.length === 0
  }

  // ── Build FormData ───────────────────────────────────────────────────────────

  const buildFormData = (f: CoachingFormState): FormData => {
    const fd = new FormData()
    if (isEdit) {
      fd.append('csr_id', String(f.csr_ids[0] || ''))
    } else {
      fd.append('csr_ids', f.csr_ids.join(','))
    }
    fd.append('coach_id',               String(f.coach_id || user?.id || ''))
    fd.append('session_date',           f.session_date)
    fd.append('coaching_purpose',       f.coaching_purpose)
    fd.append('coaching_format',        f.coaching_format)
    fd.append('source_type',            f.source_type)
    fd.append('notes',                  f.notes)
    fd.append('topic_ids',              f.topic_ids.join(','))
    fd.append('required_action',        f.required_action)
    fd.append('resource_ids',           f.kb_resource_ids.join(','))
    fd.append('quiz_ids',               f.quiz_ids.join(','))
    fd.append('require_acknowledgment', String(f.require_acknowledgment))
    fd.append('require_action_plan',    String(f.require_action_plan))
    fd.append('follow_up_required',     String(f.follow_up_required))
    fd.append('due_date',               f.due_date         || '')
    fd.append('follow_up_date',         f.follow_up_date   || '')
    fd.append('follow_up_notes',        f.follow_up_notes  || '')
    fd.append('internal_notes',         f.internal_notes   || '')
    fd.append('behavior_flag_ids',      f.behavior_flag_ids.join(','))
    fd.append('root_cause_ids',         f.root_cause_ids.join(','))
    fd.append('support_needed_ids',     f.support_needed_ids.join(','))
    if (f.attachment_file) fd.append('attachment', f.attachment_file)
    if (removeAttachment && !f.attachment_file) fd.append('remove_attachment', 'true')
    return fd
  }

  // ── Save mutation (save as Draft / update content) ───────────────────────

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!runValidation()) throw new Error('validation')
      const fd = buildFormData(getValues())
      if (isEdit) {
        await trainingService.updateCoachingSession(Number(id), fd)
        return { isEdit: true, count: 1 }
      }
      const result = await trainingService.createCoachingSession(fd)
      return { isEdit: false, count: result.count ?? 1 }
    },
    onSuccess: ({ isEdit: edited, count }) => {
      qc.invalidateQueries({ queryKey: ['coaching-session', id] })
      qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
      toast({ title: edited ? 'Session saved' : (count > 1 ? `${count} draft sessions created` : 'Draft saved') })
      navigate('/app/training/coaching')
    },
    onError: (err: Error) => {
      if (err?.message !== 'validation')
        toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    },
  })

  // ── Schedule mutation (save + deliver to Agent) ──────────────────────────

  const scheduleMut = useMutation({
    mutationFn: async () => {
      if (!runValidation()) throw new Error('validation')
      const fd = buildFormData(getValues())
      if (isEdit) {
        await trainingService.updateCoachingSession(Number(id), fd)
        return { isEdit: true, singleId: Number(id) }
      }
      const created = await trainingService.createCoachingSession(fd)
      if (created.ids && created.ids.length > 1) {
        await Promise.all(created.ids.map((sid: number) => trainingService.deliverSession(sid)))
        return { isEdit: false, count: created.ids.length }
      }
      const singleId = created.id ?? created.ids?.[0]
      if (singleId) await trainingService.deliverSession(singleId)
      return { isEdit: false, singleId }
    },
    onSuccess: ({ isEdit: edited, count, singleId }) => {
      qc.invalidateQueries({ queryKey: ['coaching-session', id] })
      qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
      if (edited) {
        toast({ title: 'Session scheduled — Agent will see it as Upcoming' })
        navigate(`/app/training/coaching/${id}`)
      } else if (count) {
        toast({ title: `${count} sessions scheduled` })
        navigate('/app/training/coaching')
      } else {
        toast({ title: 'Session scheduled' })
        navigate(singleId ? `/app/training/coaching/${singleId}` : '/app/training/coaching')
      }
    },
    onError: (err: Error) => {
      if (err?.message !== 'validation')
        toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    },
  })

  const isSaving = saveMut.isPending || scheduleMut.isPending
  const recentSessions    = history?.sessions ?? []
  const priorYearSessions = history?.prior_year_sessions ?? []
  const repeatTopics      = history?.repeat_topics ?? []

  if (isEdit && existingError) {
    return (
      <QualityListPage>
        <TableErrorState message="Failed to load training session." onRetry={existingRefetch} />
      </QualityListPage>
    )
  }

  return (
    <QualityListPage>
      <QualityPageHeader
        title={isEdit ? 'Edit Training Session' : 'New Training Session'}
        actions={<Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>}
      />

      <div className="grid grid-cols-3 gap-6">

        {/* ── Main Form ─────────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          <SessionSection
            form={form} errors={errors} csrs={agents}
            coaches={coaches} topicItems={topicItems} isEdit={isEdit}
            purposeItems={purposeItems} formatItems={formatItems} sourceItems={sourceItems}
            update={update} toggleTopic={toggleTopic}
          />
          <RequiredActionsSection
            form={form} errors={errors} resources={resources}
            quizzes={quizzes} update={update}
          />
          <AccountabilitySection form={form} errors={errors} update={update} />
          <AttachmentCard
            filename={existingFilename || (form.attachment_file ? form.attachment_file.name : undefined)}
            editable
            onFileSelect={f => { update('attachment_file', f); setRemoveAttachment(false) }}
            onRemove={() => { update('attachment_file', null); setExistingFilename(undefined); setRemoveAttachment(true) }}
          />
          {[ROLE_IDS.ADMIN, ROLE_IDS.TRAINER, ROLE_IDS.MANAGER].some(r => r === (user?.role_id ?? 0)) && (
            <InternalNotesSection form={form} flagItems={flagItems}
              rootCauseItems={rootCauseItems} supportNeededItems={supportNeededItems}
              update={update} />
          )}
        </div>

        {/* ── Agent History Panel (shared) ─────────────────────────────── */}
        <div className="col-span-1">
          <AgentHistoryPanel
            recentSessions={recentSessions}
            priorYearSessions={priorYearSessions}
            repeatTopics={repeatTopics}
            loading={historyLoading}
            noAgentMessage={!agentId ? 'Select an Agent to see history' : undefined}
          />
        </div>

      </div>

      {/* ── Bottom Action Bar ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between mt-2">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={isSaving}>Cancel</Button>
        <div className="flex items-center gap-3">
          {(!isEdit || existing?.status === 'SCHEDULED') ? (
            <>
              <Button variant="outline" onClick={() => saveMut.mutate()} disabled={isSaving}>
                {saveMut.isPending ? 'Saving…' : isEdit ? 'Save Draft' : 'Save as Draft'}
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-white"
                onClick={() => scheduleMut.mutate()}
                disabled={isSaving}
              >
                {scheduleMut.isPending ? 'Saving…' : 'Schedule Session'}
              </Button>
            </>
          ) : (
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => saveMut.mutate()}
              disabled={isSaving}
            >
              {saveMut.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
        </div>
      </div>

    </QualityListPage>
  )
}
