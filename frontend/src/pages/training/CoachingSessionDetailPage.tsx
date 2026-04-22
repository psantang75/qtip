import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_IDS } from '@/hooks/useQualityRole'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import trainingService, { type CoachingSession, type CoachingSourceType, type CoachingFormat, type CoachingPurpose } from '@/services/trainingService'
import listService from '@/services/listService'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/common/RichTextEditor'

import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import {
  COACHING_PURPOSE_LABELS as PURPOSE_MAP,
  COACHING_FORMAT_LABELS as FORMAT_MAP,
  COACHING_STATUS_LABELS as STATUS_LABELS,
  COACHING_SOURCE_LABELS as SOURCE_LABELS,
} from '@/constants/labels'
import {
  SessionSection, RequiredActionsSection, AccountabilitySection, InternalNotesSection,
} from './coaching-form/CoachingFormSections'
import { AgentHistoryPanel } from './coaching-form/AgentHistoryPanel'
import { AttachmentCard } from '@/components/training/AttachmentCard'
import { ResourcesTable, QuizSummaryTable } from '@/components/training/ReadOnlySections'
import { emptyForm, type CoachingFormState } from './coaching-form/types'

import { Section, Sub, InfoRow, NoteBlock, SideCard, SideTitle, ProgressRow, TopicList, ListItemReadOnly } from './training-detail/layout'
import { InternalNotesPanel } from '@/components/common/InternalNotesPanel'
import { downloadSessionAttachment } from '@/utils/trainingHelpers'

// ── Section edit bar (detail page specific) ───────────────────────────────────

function SectionEditBar({ onSave, onCancel, saving, showBatch, applyToBatch, onToggleBatch, onSaveAndClose, showSaveAndClose }: {
  onSave: () => void; onCancel: () => void; saving: boolean
  showBatch?: boolean; applyToBatch?: boolean; onToggleBatch?: () => void
  onSaveAndClose?: () => void; showSaveAndClose?: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 mt-2">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <div className="flex items-center gap-3">
          {showBatch && (
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-slate-500">
              <input type="checkbox" checked={applyToBatch} onChange={onToggleBatch}
                className="accent-primary h-3.5 w-3.5" />
              Apply to entire batch
            </label>
          )}
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-white"
            onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : applyToBatch ? 'Save to All' : 'Save'}
          </Button>
          {showSaveAndClose && onSaveAndClose && (
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
              onClick={onSaveAndClose} disabled={saving}>
              {saving ? 'Saving…' : 'Save & Close'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function QuizSummary({ session }: { session: CoachingSession }) {
  const hasQuizzes = (session.quizzes?.length ?? 0) > 0
  if (!hasQuizzes) return <span className="text-[12px] text-slate-400">Not assigned</span>
  const attempts = session.quiz_attempts ?? []
  const passed   = attempts.find(a => a.passed)
  if (passed) return <span className="text-[12px] text-slate-700">{formatQualityDate(passed.submitted_at)}</span>
  if (attempts.length) {
    const best = Math.max(...attempts.map(a => Number(a.score)))
    return <span className="text-[12px] text-amber-700">Failed — best {best.toFixed(0)}%</span>
  }
  return <span className="text-[12px] text-slate-400">Pending</span>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CoachingSessionDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()
  const { user }  = useAuth()
  const canSeeInternal = [ROLE_IDS.ADMIN, ROLE_IDS.TRAINER, ROLE_IDS.MANAGER].some(r => r === (user?.role_id ?? 0))
  const [pendingStatus,  setPendingStatus]  = useState('')

  const { data: session, isLoading, isError } = useQuery({
    queryKey:  ['coaching-session', id],
    queryFn:   () => trainingService.getCoachingSessionDetail(Number(id)),
    enabled:   !!id,
    staleTime: 0,
  })

  // ── Reference data (cached — needed for inline editing) ───────────────────
  const { data: flagItems = [] }           = useQuery({ queryKey: ['list-items', 'behavior_flag'],    queryFn: () => listService.getItems('behavior_flag') })
  const { data: rootCauseItems = [] }     = useQuery({ queryKey: ['list-items', 'root_cause'],       queryFn: () => listService.getItems('root_cause') })
  const { data: supportNeededItems = [] } = useQuery({ queryKey: ['list-items', 'support_needed'],    queryFn: () => listService.getItems('support_needed') })
  const { data: purposeItems = [] }       = useQuery({ queryKey: ['list-items', 'coaching_purpose'], queryFn: () => listService.getItems('coaching_purpose') })
  const { data: formatItems = [] }        = useQuery({ queryKey: ['list-items', 'coaching_format'],  queryFn: () => listService.getItems('coaching_format') })
  const { data: sourceItems = [] }        = useQuery({ queryKey: ['list-items', 'coaching_source'],  queryFn: () => listService.getItems('coaching_source') })
  const { data: agents = [] }  = useQuery({ queryKey: ['team-agents'],  queryFn: () => trainingService.getTeamCSRs() })
  const { data: coaches = [] } = useQuery({ queryKey: ['eligible-coaches'], queryFn: () => trainingService.getCoaches() })
  const { data: topicsData }   = useQuery({ queryKey: ['list-items', 'training_topic'], queryFn: () => listService.getItems('training_topic') })
  const { data: resourcesData }= useQuery({ queryKey: ['resources'],     queryFn: () => trainingService.getResources({ is_active: true, limit: 200 }) })
  const { data: quizLibrary }  = useQuery({ queryKey: ['quiz-library'],  queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })
  const topics    = topicsData ?? []
  const resources = resourcesData?.items ?? []
  const quizzes   = quizLibrary?.items   ?? []

  // ── Section inline editing ────────────────────────────────────────────────
  // Required Actions + Agent Accountability always edit together ('actions-accountability')
  type EditSection = 'session' | 'actions-accountability' | null
  const [editSection, setEditSection]   = useState<EditSection>(null)
  const [formDraft, setFormDraft]       = useState<CoachingFormState>(emptyForm)
  const [applyToBatch, setApplyToBatch] = useState(false)
  const [removeAttachment, setRemoveAttachment] = useState(false)
  const [attachmentFilename, setAttachmentFilename] = useState<string | undefined>()
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [editingAttachment, setEditingAttachment] = useState(false)

  // Internal notes independent edit state
  const [editingInternal, setEditingInternal] = useState(false)
  const [internalDraft, setInternalDraft] = useState({
    follow_up_notes: '', internal_notes: '',
    behavior_flag_ids: [] as number[], root_cause_ids: [] as number[], support_needed_ids: [] as number[],
  })
  const [internalApplyBatch, setInternalApplyBatch] = useState(false)
  const updateInternalDraft = <K extends keyof typeof internalDraft>(k: K, v: (typeof internalDraft)[K]) =>
    setInternalDraft(d => ({ ...d, [k]: v }))

  const updateDraft = useCallback(<K extends keyof CoachingFormState>(k: K, v: CoachingFormState[K]) => {
    setFormDraft(f => ({ ...f, [k]: v }))
  }, [])

  const toggleDraftTopic = useCallback((topicId: number) => {
    setFormDraft(f => ({
      ...f,
      topic_ids: f.topic_ids.includes(topicId)
        ? f.topic_ids.filter(x => x !== topicId)
        : [...f.topic_ids, topicId],
    }))
  }, [])

  const startEdit = (section: EditSection) => {
    if (!session) return
    setFormDraft({
      csr_ids:                [session.csr_id],
      coach_id:               session.created_by ?? user?.id ?? 0,
      session_date:           session.session_date?.slice(0, 16) ?? '',
      coaching_purpose:       session.coaching_purpose,
      coaching_format:        session.coaching_format,
      source_type:            session.source_type,
      notes:                  session.notes ?? '',
      topic_ids:              session.topic_ids ?? [],
      required_action:        session.required_action ?? '',
      kb_resource_ids:        (session.kb_resources ?? []).map(r => r.id),
      quiz_ids:               (session.quizzes ?? []).map(q => q.id),
      require_acknowledgment: session.require_acknowledgment ?? false,
      require_action_plan:    session.require_action_plan ?? false,
      due_date:               session.due_date?.slice(0, 10) ?? '',
      follow_up_required:     !!session.follow_up_required || !!session.follow_up_date,
      follow_up_date:         session.follow_up_date?.slice(0, 10) ?? '',
      follow_up_notes:        session.follow_up_notes ?? '',
      internal_notes:         session.internal_notes ?? '',
      behavior_flag_ids:      session.behavior_flag_ids ?? [],
      root_cause_ids:         session.root_cause_ids ?? [],
      support_needed_ids:     session.support_needed_ids ?? [],
      attachment_file:        null,
    })
    setEditSection(section)
  }

  const cancelEdit = () => { setEditSection(null); setApplyToBatch(false) }

  const buildFormData = () => {
    const fd = new FormData()
    fd.append('csr_id',               String(formDraft.csr_ids[0] || ''))
    fd.append('coach_id',             String(formDraft.coach_id))
    fd.append('session_date',         formDraft.session_date)
    fd.append('coaching_purpose',     formDraft.coaching_purpose)
    fd.append('coaching_format',      formDraft.coaching_format)
    fd.append('source_type',          formDraft.source_type)
    fd.append('notes',                formDraft.notes)
    fd.append('topic_ids',            formDraft.topic_ids.join(','))
    fd.append('required_action',      formDraft.required_action)
    fd.append('resource_ids',         formDraft.kb_resource_ids.join(','))
    fd.append('quiz_ids',             formDraft.quiz_ids.join(','))
    fd.append('require_acknowledgment', String(formDraft.require_acknowledgment))
    fd.append('require_action_plan',  String(formDraft.require_action_plan))
    fd.append('due_date',             formDraft.due_date || '')
    fd.append('follow_up_required',   String(formDraft.follow_up_required))
    fd.append('follow_up_date',       formDraft.follow_up_date || '')
    fd.append('follow_up_notes',      formDraft.follow_up_notes || '')
    fd.append('internal_notes',       formDraft.internal_notes || '')
    fd.append('behavior_flag_ids',    formDraft.behavior_flag_ids.join(','))
    fd.append('root_cause_ids',       formDraft.root_cause_ids.join(','))
    fd.append('support_needed_ids',   formDraft.support_needed_ids.join(','))
    if (applyToBatch) fd.append('apply_to_batch', 'true')
    return fd
  }

  const sectionSaveMut = useMutation({
    mutationFn: () => trainingService.updateCoachingSession(Number(id), buildFormData()),
    onSuccess: () => {
      toast({ title: 'Section saved' })
      setEditSection(null)
      invalidate()
      qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['coaching-session', id] })
    qc.invalidateQueries({ queryKey: ['coaching-sessions'] })
  }

  const attachmentSaveMut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      if (attachmentFile) fd.append('attachment', attachmentFile)
      else if (removeAttachment) fd.append('remove_attachment', 'true')
      return trainingService.updateCoachingSession(Number(id), fd)
    },
    onSuccess: () => {
      toast({ title: 'Attachment saved' })
      setEditingAttachment(false)
      setRemoveAttachment(false)
      setAttachmentFilename(undefined)
      setAttachmentFile(null)
      invalidate()
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  const startEditInternal = () => {
    if (!session) return
    setInternalDraft({
      follow_up_notes:    session.follow_up_notes ?? '',
      internal_notes:     session.internal_notes ?? '',
      behavior_flag_ids:  session.behavior_flag_ids ?? [],
      root_cause_ids:     session.root_cause_ids ?? [],
      support_needed_ids: session.support_needed_ids ?? [],
    })
    setEditingInternal(true)
  }

  const cancelEditInternal = () => { setEditingInternal(false); setInternalApplyBatch(false) }

  const internalSaveMut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('follow_up_notes',   internalDraft.follow_up_notes || '')
      fd.append('internal_notes',    internalDraft.internal_notes || '')
      fd.append('behavior_flag_ids', internalDraft.behavior_flag_ids.join(','))
      fd.append('root_cause_ids',    internalDraft.root_cause_ids.join(','))
      fd.append('support_needed_ids', internalDraft.support_needed_ids.join(','))
      if (internalApplyBatch) fd.append('apply_to_batch', 'true')
      return trainingService.updateCoachingSession(Number(id), fd)
    },
    onSuccess: () => {
      toast({ title: 'Section saved' })
      setEditingInternal(false)
      setInternalApplyBatch(false)
      invalidate()
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  const internalSaveAndCloseMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('follow_up_notes',   internalDraft.follow_up_notes || '')
      fd.append('internal_notes',    internalDraft.internal_notes || '')
      fd.append('behavior_flag_ids', internalDraft.behavior_flag_ids.join(','))
      fd.append('root_cause_ids',    internalDraft.root_cause_ids.join(','))
      fd.append('support_needed_ids', internalDraft.support_needed_ids.join(','))
      if (internalApplyBatch) fd.append('apply_to_batch', 'true')
      await trainingService.updateCoachingSession(Number(id), fd)
      await trainingService.setSessionStatus(Number(id), 'CLOSED')
    },
    onSuccess: () => {
      toast({ title: 'Session saved and closed' })
      setEditingInternal(false)
      setInternalApplyBatch(false)
      invalidate()
    },
    onError: () => toast({ title: 'Save & close failed', variant: 'destructive' }),
  })

  useEffect(() => { if (session) setPendingStatus(session.status) }, [session?.status])

  // Auto-open editable sections based on status (re-runs on manual status changes)
  useEffect(() => {
    if (!session) return
    setEditSection(null)
    setEditingAttachment(false)
    setEditingInternal(false)

    if (['DRAFT', 'SCHEDULED'].includes(session.status)) {
      startEdit('actions-accountability')
    } else if (['COMPLETED', 'FOLLOW_UP_REQUIRED'].includes(session.status) && canSeeInternal) {
      startEditInternal()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status])

  const statusMut = useMutation({
    mutationFn: (status: string) => trainingService.setSessionStatus(Number(id), status),
    onSuccess: (_d, status) => {
      setEditSection(null)
      setEditingAttachment(false)
      setEditingInternal(false)
      toast({ title: `Status updated to ${STATUS_LABELS[status] ?? status}` })
      invalidate()
    },
    onError: () => toast({ title: 'Error', description: 'Could not update status.', variant: 'destructive' }),
  })

  const deliverMut = useMutation({
    mutationFn: () => trainingService.deliverSession(Number(id)),
    onSuccess: () => { toast({ title: 'Training session scheduled' }); invalidate() },
    onError: () => toast({ title: 'Error', description: 'Could not deliver session.', variant: 'destructive' }),
  })


  const handleDownload = async () => {
    if (!session?.attachment_filename) return
    try { await downloadSessionAttachment(Number(id), session.attachment_filename) }
    catch { toast({ title: 'Download failed', variant: 'destructive' }) }
  }

  if (isLoading) return <div className="p-6"><ListLoadingSkeleton rows={10} /></div>
  if (isError || !session) return (
    <div className="p-6">
      <TableErrorState message="Failed to load session."
        onRetry={() => qc.invalidateQueries({ queryKey: ['coaching-session', id] })} />
    </div>
  )

  const canEditSession     = session.status === 'DRAFT'
  const canEditActions     = ['DRAFT', 'SCHEDULED'].includes(session.status)
  const canEditAttachment  = session.status === 'DRAFT'
  const canEditInternal    = canSeeInternal && !['CLOSED', 'CANCELED'].includes(session.status)
  const recentSessions     = session.recent_sessions ?? []
  const priorYearSessions  = session.prior_year_sessions ?? []
  const repeatTopics       = session.repeat_topics ?? []


  return (
    <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>

      <div className="shrink-0 px-6 pt-6 pb-5">
        <ListPageHeader
          title={`Training Session #${id}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/app/training/coaching')}>← Back</Button>
              {canEditSession && (
                <Button variant="outline" className="border-primary text-primary hover:bg-primary/5"
                  onClick={() => navigate(`/app/training/coaching/${id}/edit`)}>
                  Edit Full Session
                </Button>
              )}
            </div>
          }
        />
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6">
        <div className="grid grid-cols-3 gap-6 h-full">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="col-span-2 overflow-y-auto space-y-4 pr-2">

          {/* ── Section 1: Session ──────────────────────────────────────── */}
          {editSection === 'session' ? (
            <>
              <SessionSection form={formDraft} errors={{}} csrs={agents} coaches={coaches}
                topicItems={topics} isEdit
                purposeItems={purposeItems} formatItems={formatItems} sourceItems={sourceItems}
                update={updateDraft} toggleTopic={toggleDraftTopic} />
              <SectionEditBar onSave={() => sectionSaveMut.mutate()} onCancel={cancelEdit} saving={sectionSaveMut.isPending} showBatch={!!session?.batch_id} applyToBatch={applyToBatch} onToggleBatch={() => setApplyToBatch(v => !v)} />
            </>
          ) : null}
          {editSection !== 'session' && <Section title="Session" onEdit={canEditSession ? () => startEdit('session') : undefined}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoRow label="Agent"            value={session.csr_name} />
              <InfoRow label="Coach"            value={session.created_by_name} />
              <InfoRow label="Session Date"     value={formatQualityDate(session.session_date)} />
              <InfoRow label="Coaching Format"  value={formatItems.find(i => i.item_key === session.coaching_format)?.label ?? FORMAT_MAP[session.coaching_format as CoachingFormat] ?? session.coaching_format} />
              <InfoRow label="Coaching Purpose" value={purposeItems.find(i => i.item_key === session.coaching_purpose)?.label ?? PURPOSE_MAP[session.coaching_purpose as CoachingPurpose] ?? session.coaching_purpose} />
              <InfoRow label="Coaching Source"  value={sourceItems.find(i => i.item_key === session.source_type)?.label ?? SOURCE_LABELS[session.source_type as CoachingSourceType] ?? session.source_type} />
              <InfoRow label="Created"          value={formatQualityDate(session.created_at)} />
              {!!session.is_overdue && (
                <InfoRow label="Overdue" value={<span className="text-[14px] font-semibold text-red-600">⚠ Overdue</span>} />
              )}
            </div>

            {/* Topics */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Topics</p>
              <TopicList topics={session.topics} columns={3} bold />
            </div>

            {/* Notes */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
              <NoteBlock text={session.notes} placeholder="No notes provided" bold />
              {session.qa_audit_id && (
                <a href={`/app/quality/submissions/${session.qa_audit_id}`}
                  className="inline-flex items-center gap-1 text-primary text-[13px] mt-2 hover:underline">
                  View QA Audit →
                </a>
              )}
            </div>
          </Section>}

          {/* ── Sections 2 + 3: Required Actions + Agent Accountability (edit together) ── */}
          {editSection === 'actions-accountability' ? (
            <>
              <RequiredActionsSection form={formDraft} errors={{}} resources={resources} quizzes={quizzes} update={updateDraft} />
              <AccountabilitySection form={formDraft} errors={{}} update={updateDraft} hideFollowUpNotes />
              <SectionEditBar onSave={() => sectionSaveMut.mutate()} onCancel={cancelEdit} saving={sectionSaveMut.isPending} showBatch={!!session?.batch_id} applyToBatch={applyToBatch} onToggleBatch={() => setApplyToBatch(v => !v)} />
            </>
          ) : null}

          {/* ── Section 2: Required Actions (read-only) ─────────────────────── */}
          {editSection !== 'actions-accountability' && <Section title="Required Actions" onEdit={canEditActions ? () => startEdit('actions-accountability') : undefined}>

            {/* Required Action Notes */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Required Action Notes</p>
            <NoteBlock text={session.required_action} placeholder="No required action specified" bold />

            <ResourcesTable resources={session.kb_resources ?? []} />
            <QuizSummaryTable quizzes={session.quizzes ?? []} attempts={session.quiz_attempts ?? []} />


          </Section>}

          {/* ── Section 3: Agent Accountability (read-only) ─────────────────── */}
          {editSection !== 'actions-accountability' && <Section title="Agent Accountability" onEdit={canEditActions ? () => startEdit('actions-accountability') : undefined}>

            {/* Action Plan */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Action Plan</p>
            {session.require_action_plan ? (
              <NoteBlock text={session.csr_action_plan} placeholder="Pending" bold />
            ) : (
              <p className="text-[13px] text-slate-400">Not required</p>
            )}

            {/* Acknowledgment */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Acknowledgment</p>
              {session.require_acknowledgment ? (
                <NoteBlock
                  text={session.csr_acknowledged_at ? formatQualityDate(session.csr_acknowledged_at) : null}
                  placeholder="Pending" bold
                />
              ) : (
                <p className="text-[13px] text-slate-400">Not required</p>
              )}
            </div>

            {/* Timing — due dates govern when Agent must complete their work */}
            <Sub title="Timing">
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoRow label="Due Date" value={session.due_date
                  ? <span className={session.is_overdue ? 'text-red-600' : undefined}>
                      {formatQualityDate(session.due_date)}{session.is_overdue ? ' ⚠' : ''}
                    </span>
                  : null} />
                <InfoRow label="Follow-Up Date" value={session.follow_up_date
                  ? formatQualityDate(session.follow_up_date)
                  : null} />
              </div>
              {!!session.follow_up_notes && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Follow-Up Notes</p>
                  <NoteBlock text={session.follow_up_notes} placeholder="" bold />
                </div>
              )}
            </Sub>

          </Section>}

          {/* ── Attachment (always visible) ────────────────────────────────── */}
          {editingAttachment ? (
            <>
              <AttachmentCard
                filename={attachmentFilename || (attachmentFile ? attachmentFile.name : undefined)}
                onDownload={attachmentFilename ? handleDownload : undefined}
                editable
                onFileSelect={f => { setAttachmentFile(f); setRemoveAttachment(false) }}
                onRemove={() => { setAttachmentFile(null); setAttachmentFilename(undefined); setRemoveAttachment(true) }}
              />
              <SectionEditBar
                onSave={() => attachmentSaveMut.mutate()}
                onCancel={() => { setEditingAttachment(false); setRemoveAttachment(false); setAttachmentFilename(undefined); setAttachmentFile(null) }}
                saving={attachmentSaveMut.isPending}
              />
            </>
          ) : (
            <AttachmentCard
              filename={session.attachment_filename}
              onDownload={session.attachment_filename ? handleDownload : undefined}
              onEdit={canEditAttachment ? () => { setAttachmentFilename(session.attachment_filename ?? undefined); setEditingAttachment(true) } : undefined}
            />
          )}

          {/* ── Internal Notes (trainer/manager/admin only) ─────────────── */}
          {canSeeInternal && editingInternal ? (
            <>
              {session.status === 'FOLLOW_UP_REQUIRED' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
                    <h3 className="text-[15px] font-semibold text-slate-800">Follow-Up Notes</h3>
                  </div>
                  <div className="p-5">
                    <RichTextEditor value={internalDraft.follow_up_notes}
                      placeholder="Document notes from the follow-up meeting…"
                      onChange={html => updateInternalDraft('follow_up_notes', html)} />
                  </div>
                </div>
              )}
              <InternalNotesSection form={internalDraft as any} flagItems={flagItems}
                rootCauseItems={rootCauseItems} supportNeededItems={supportNeededItems}
                update={(k: any, v: any) => updateInternalDraft(k, v)} />
              <SectionEditBar
                onSave={() => internalSaveMut.mutate()}
                onCancel={cancelEditInternal}
                saving={internalSaveMut.isPending || internalSaveAndCloseMut.isPending}
                showBatch={!!session?.batch_id}
                applyToBatch={internalApplyBatch}
                onToggleBatch={() => setInternalApplyBatch(v => !v)}
                showSaveAndClose={['COMPLETED', 'FOLLOW_UP_REQUIRED'].includes(session.status)}
                onSaveAndClose={() => internalSaveAndCloseMut.mutate()}
              />
            </>
          ) : canSeeInternal ? (
            <InternalNotesPanel
              internalNotes={session.internal_notes}
              behaviorFlagItems={session.behavior_flag_items}
              rootCauseItems={session.root_cause_items}
              supportNeededItems={session.support_needed_items}
              legacyRootCauseText={session.csr_root_cause}
              legacySupportNeededText={session.csr_support_needed}
              canEdit={canEditInternal}
              onEdit={startEditInternal}
            />
          ) : null}



        </div>

          {/* ── Right column ────────────────────────────────────────────────── */}
          <div className="col-span-1 overflow-y-auto space-y-4 pl-2">

          {/* Status panel */}
          <SideCard>
            <SideTitle>Status</SideTitle>
            {session.status === 'CLOSED' ? (
              <p className="text-[12px] text-slate-400 italic">This session is closed and archived.</p>
            ) : session.status === 'CANCELED' ? (
              <p className="text-[12px] text-slate-400 italic">This session was canceled.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Current</p>
                  <p className="text-[14px] font-semibold text-slate-900">{STATUS_LABELS[session.status] ?? session.status}</p>
                </div>
                {/* Schedule — only when DRAFT, triggers Agent visibility + auto-status */}
                {session.status === 'DRAFT' && (
                  <div className="border-t border-slate-100 pt-3">
                    <Button
                      className="w-full bg-primary hover:bg-primary/90 text-white h-9 text-[13px] font-semibold"
                      onClick={() => deliverMut.mutate()}
                      disabled={deliverMut.isPending || statusMut.isPending}
                    >
                      {deliverMut.isPending ? 'Scheduling…' : 'Schedule Training Session'}
                    </Button>
                  </div>
                )}

              <div className="border-t border-slate-100 pt-3 space-y-2">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide">Change to</p>
                  <select
                    className="w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                    value={pendingStatus}
                    onChange={e => setPendingStatus(e.target.value)}
                  >
                    {(['DRAFT', 'SCHEDULED', 'AWAITING_CSR_ACTION', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED', 'CANCELED'] as const).map(s => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}{s === 'CLOSED' || s === 'CANCELED' ? ' (Final)' : ''}</option>
                    ))}
                  </select>
                  <Button
                    className={cn(
                      'w-full h-8 text-[12px]',
                      pendingStatus === 'CLOSED' || pendingStatus === 'CANCELED'
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-primary hover:bg-primary/90 text-white'
                    )}
                    disabled={pendingStatus === session.status || statusMut.isPending}
                    onClick={() => statusMut.mutate(pendingStatus)}
                  >
                    {statusMut.isPending ? 'Updating…'
                      : pendingStatus === 'CLOSED' ? 'Close Session'
                      : pendingStatus === 'CANCELED' ? 'Cancel Session'
                      : 'Update Status'}
                  </Button>
                </div>
              </div>
            )}

            {/* Status History */}
            <div className="border-t border-slate-100 pt-3 mt-3 space-y-1.5">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-2">Status History</p>
              {session.delivered_at && (
                <ProgressRow label="Scheduled" value={<span className="text-slate-700">{formatQualityDate(session.delivered_at)}</span>} />
              )}
              {session.completed_at && (
                <ProgressRow label="Completed" value={<span className="text-slate-700">{formatQualityDate(session.completed_at)}</span>} />
              )}
              {session.closed_at && (
                <ProgressRow label="Closed" value={<span className="text-slate-700">{formatQualityDate(session.closed_at)}</span>} />
              )}
              {!session.delivered_at && !session.completed_at && !session.closed_at && (
                <p className="text-[12px] text-slate-400 italic">No history yet</p>
              )}
            </div>
          </SideCard>

          {/* Agent Response summary */}
          <SideCard>
            <SideTitle>Agent Response</SideTitle>
            <ProgressRow label="Action Plan"
              muted={!session.require_action_plan}
              value={session.csr_action_plan
                ? <span className="text-slate-700">
                    {session.csr_acknowledged_at
                      ? formatQualityDate(session.csr_acknowledged_at)
                      : 'Submitted'}
                  </span>
                : <span className={session.require_action_plan ? 'text-amber-600' : 'text-slate-400'}>
                    {session.require_action_plan ? 'Pending' : 'Not required'}
                  </span>} />
            <ProgressRow label="Acknowledged"
              muted={!session.require_acknowledgment}
              value={session.csr_acknowledged_at
                ? <span className="text-slate-700">{formatQualityDate(session.csr_acknowledged_at)}</span>
                : <span className={session.require_acknowledgment ? 'text-amber-600' : 'text-slate-400'}>
                    {session.require_acknowledgment ? 'Pending' : 'Not required'}
                  </span>} />
            <ProgressRow label="Quiz Passed" value={<QuizSummary session={session} />} />
          </SideCard>

          {/* Prior Sessions (shared component) */}
          <AgentHistoryPanel
            agentName={session.csr_name}
            recentSessions={recentSessions}
            priorYearSessions={priorYearSessions}
            repeatTopics={repeatTopics}
          />

          </div>
        </div>
      </div>

    </div>
  )
}
