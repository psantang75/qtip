import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Download, Paperclip, BookOpen, HelpCircle, Pencil } from 'lucide-react'
import trainingService, { type CoachingSession, type CoachingSourceType } from '@/services/trainingService'
import topicService from '@/services/topicService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { PURPOSE_MAP, FORMAT_MAP, STATUS_LABELS } from './CoachingSessionsPage'
import {
  BEHAVIOR_FLAG_GROUPS,
  SessionSection, RequiredActionsSection, AccountabilitySection, InternalNotesSection,
} from './coaching-form/CoachingFormSections'
import { emptyForm, type CoachingFormState } from './coaching-form/types'

// ── Source labels ─────────────────────────────────────────────────────────────

/** Returns the correct href for a resource — URL type uses the url field; uploaded files use the API. */
function resourceHref(r: { id: number; resource_type?: string; url?: string }, forCSR = false): string {
  if (r.resource_type === 'URL' && r.url) return r.url
  if (r.url) return r.url
  return forCSR ? `/api/csr/resources/${r.id}/file` : `/api/trainer/resources/${r.id}/file`
}

const SOURCE_LABELS: Record<CoachingSourceType, string> = {
  QA_AUDIT: 'QA Audit', MANAGER_OBSERVATION: 'Manager Observation', TREND: 'Trend',
  DISPUTE: 'Dispute', SCHEDULED: 'Scheduled', OTHER: 'Other',
}

// ── Layout primitives — mirrors CoachingFormSections exactly ─────────────────

function Section({ title, children, onEdit }: {
  title: string; children: React.ReactNode; onEdit?: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {onEdit && (
          <button type="button" onClick={onEdit}
            className="flex items-center gap-1 text-slate-400 hover:text-primary transition-colors text-[12px]">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function SectionEditBar({ onSave, onCancel, saving, showBatch, applyToBatch, onToggleBatch }: {
  onSave: () => void; onCancel: () => void; saving: boolean
  showBatch?: boolean; applyToBatch?: boolean; onToggleBatch?: () => void
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
            {saving ? 'Saving…' : applyToBatch ? 'Save to All' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Sub({ title, icon: Icon, children }: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="pt-4 mt-4 border-t border-slate-100">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />}{title}
      </p>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-[13px] text-slate-800 font-medium">{value ?? '—'}</div>
    </div>
  )
}

function SideCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-slate-200 p-4', className)}>{children}</div>
}

function SideTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2.5 mb-3">{children}</h3>
}

function ResponseRow({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className={cn('text-[12px] font-medium', muted ? 'text-slate-400' : 'text-slate-500')}>{label}</span>
      <span className={cn('text-[12px] text-right shrink-0', muted ? 'text-slate-400' : 'text-slate-700')}>{value}</span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function NoteBlock({ text, placeholder }: { text?: string | null; placeholder: string }) {
  return text
    ? <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{text}</p>
    : <p className="text-[13px] text-slate-400 italic">{placeholder}</p>
}

function TopicList({ topics }: { topics: string[] }) {
  if (!topics.length) return <span className="text-[13px] text-slate-400">None</span>
  return (
    <ul className="space-y-1">
      {topics.map(t => (
        <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
        </li>
      ))}
    </ul>
  )
}

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
  const canSeeInternal = [1, 4, 5].includes(user?.role_id ?? 0)
  const [showHistory,    setShowHistory]    = useState(false)
  const [pendingStatus,  setPendingStatus]  = useState('')

  const { data: session, isLoading, isError } = useQuery({
    queryKey:  ['coaching-session', id],
    queryFn:   () => trainingService.getCoachingSessionDetail(Number(id)),
    enabled:   !!id,
    staleTime: 0,
  })

  // ── Reference data (cached — needed for inline editing) ───────────────────
  const { data: csrs = [] }    = useQuery({ queryKey: ['team-csrs'],    queryFn: () => trainingService.getTeamCSRs() })
  const { data: coaches = [] } = useQuery({ queryKey: ['eligible-coaches'], queryFn: () => trainingService.getCoaches() })
  const { data: topicsData }   = useQuery({ queryKey: ['topics-active'], queryFn: () => topicService.getTopics(1, 200, { is_active: true }) })
  const { data: resourcesData }= useQuery({ queryKey: ['resources'],     queryFn: () => trainingService.getResources({ is_active: true, limit: 200 }) })
  const { data: quizLibrary }  = useQuery({ queryKey: ['quiz-library'],  queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })
  const topics    = topicsData?.items    ?? []
  const resources = resourcesData?.items ?? []
  const quizzes   = quizLibrary?.items   ?? []

  // ── Section inline editing ────────────────────────────────────────────────
  // Required Actions + CSR Accountability always edit together ('actions-accountability')
  type EditSection = 'session' | 'actions-accountability' | 'internal' | null
  const [editSection, setEditSection]   = useState<EditSection>(null)
  const [formDraft, setFormDraft]       = useState<CoachingFormState>(emptyForm)
  const [applyToBatch, setApplyToBatch] = useState(false)

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
      behavior_flags:         session.behavior_flags ? session.behavior_flags.split(',').filter(Boolean) : [],
      attachment_file:        null,
    })
    setEditSection(section)
  }

  const cancelEdit = () => { setEditSection(null); setApplyToBatch(false) }

  const sectionSaveMut = useMutation({
    mutationFn: () => {
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
      fd.append('behavior_flags',       formDraft.behavior_flags.join(','))
      if (applyToBatch) fd.append('apply_to_batch', 'true')
      return trainingService.updateCoachingSession(Number(id), fd)
    },
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

  useEffect(() => { if (session) setPendingStatus(session.status) }, [session?.status])

  // Auto-open Required Actions + Accountability as a form when Draft or In Process
  useEffect(() => {
    if (!session) return
    if (['SCHEDULED', 'IN_PROCESS'].includes(session.status)) {
      startEdit('actions-accountability')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id])

  const statusMut = useMutation({
    mutationFn: (status: string) => trainingService.setSessionStatus(Number(id), status),
    onSuccess: (_d, status) => { toast({ title: `Status updated to ${STATUS_LABELS[status] ?? status}` }); invalidate() },
    onError: () => toast({ title: 'Error', description: 'Could not update status.', variant: 'destructive' }),
  })

  const deliverMut = useMutation({
    mutationFn: () => trainingService.deliverSession(Number(id)),
    onSuccess: () => { toast({ title: 'Coaching session scheduled' }); invalidate() },
    onError: () => toast({ title: 'Error', description: 'Could not deliver session.', variant: 'destructive' }),
  })


  const handleDownload = async () => {
    if (!session?.attachment_filename) return
    try {
      const blob = URL.createObjectURL(await trainingService.downloadAttachment(Number(id)))
      const a = Object.assign(document.createElement('a'), { href: blob, download: session.attachment_filename })
      a.click(); URL.revokeObjectURL(blob)
    } catch { toast({ title: 'Download failed', variant: 'destructive' }) }
  }

  if (isLoading) return <QualityListPage><TableLoadingSkeleton rows={10} /></QualityListPage>
  if (isError || !session) return (
    <QualityListPage>
      <TableErrorState message="Failed to load session."
        onRetry={() => qc.invalidateQueries({ queryKey: ['coaching-session', id] })} />
    </QualityListPage>
  )

  const canEdit        = session.status !== 'CLOSED'
  const recentSessions = session.recent_sessions ?? []
  const repeatTopics   = new Set(session.repeat_topics ?? [])


  return (
    <QualityListPage>
      <QualityPageHeader
        title="Coaching Session"
        subtitle={`${session.csr_name} — ${formatQualityDate(session.session_date)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/app/training/coaching')}>← Back</Button>
            {canEdit && (
              <Button variant="outline" size="sm" className="text-[12px]"
                onClick={() => navigate(`/app/training/coaching/${id}/edit`)}>
                Edit Full Session
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-6">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">

          {/* ── Section 1: Session ──────────────────────────────────────── */}
          {editSection === 'session' ? (
            <>
              <SessionSection form={formDraft} errors={{}} csrs={csrs} coaches={coaches}
                topics={topics} update={updateDraft} toggleTopic={toggleDraftTopic} />
              <SectionEditBar onSave={() => sectionSaveMut.mutate()} onCancel={cancelEdit} saving={sectionSaveMut.isPending} showBatch={!!session?.batch_id} applyToBatch={applyToBatch} onToggleBatch={() => setApplyToBatch(v => !v)} />
            </>
          ) : null}
          {editSection !== 'session' && <Section title="Session" onEdit={canEdit ? () => startEdit('session') : undefined}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoRow label="CSR"              value={session.csr_name} />
              <InfoRow label="Coach"            value={session.created_by_name} />
              <InfoRow label="Session Date"     value={formatQualityDate(session.session_date)} />
              <InfoRow label="Coaching Format"  value={FORMAT_MAP[session.coaching_format] ?? session.coaching_format} />
              <InfoRow label="Coaching Purpose" value={PURPOSE_MAP[session.coaching_purpose] ?? session.coaching_purpose} />
              <InfoRow label="Coaching Source"  value={SOURCE_LABELS[session.source_type] ?? session.source_type} />
              <InfoRow label="Created"          value={formatQualityDate(session.created_at)} />
              {!!session.is_overdue && (
                <InfoRow label="Overdue" value={<span className="text-[13px] font-semibold text-red-600">⚠ Overdue</span>} />
              )}
            </div>

            {/* Topics */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Topics</p>
              <TopicList topics={session.topics} />
            </div>

            {/* Notes */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
              <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">
                {session.notes || <span className="text-slate-400">No notes provided</span>}
              </p>
              {session.qa_audit_id && (
                <a href={`/app/quality/submissions/${session.qa_audit_id}`}
                  className="inline-flex items-center gap-1 text-primary text-[13px] mt-2 hover:underline">
                  View QA Audit →
                </a>
              )}
            </div>
          </Section>}

          {/* ── Sections 2 + 3: Required Actions + CSR Accountability (edit together) ── */}
          {editSection === 'actions-accountability' ? (
            <>
              <RequiredActionsSection form={formDraft} errors={{}} resources={resources} quizzes={quizzes} update={updateDraft} />
              <AccountabilitySection form={formDraft} errors={{}} update={updateDraft} />
              <SectionEditBar onSave={() => sectionSaveMut.mutate()} onCancel={cancelEdit} saving={sectionSaveMut.isPending} showBatch={!!session?.batch_id} applyToBatch={applyToBatch} onToggleBatch={() => setApplyToBatch(v => !v)} />
            </>
          ) : null}

          {/* ── Section 2: Required Actions (read-only) ─────────────────────── */}
          {editSection !== 'actions-accountability' && <Section title="Required Actions" onEdit={canEdit ? () => startEdit('actions-accountability') : undefined}>

            {/* Required Action Notes */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Required Action Notes</p>
            <NoteBlock text={session.required_action} placeholder="No required action specified" />

            {/* Reference Materials */}
            <Sub title="Reference Materials" icon={BookOpen}>
              {(session.kb_resources?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {session.kb_resources!.map(r => (
                    <div key={r.id} className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-800 truncate">{r.title}</p>
                        {r.description && <p className="text-[12px] text-slate-500 mt-0.5">{r.description}</p>}
                      </div>
                      <a href={resourceHref(r)} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline shrink-0">
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-slate-400 italic">No resources assigned</p>
              )}
            </Sub>

            {/* Quizzes */}
            <Sub title="Quiz Assignment" icon={HelpCircle}>
              {(session.quizzes?.length ?? 0) > 0 ? (
                <div className="space-y-4">
                  {session.quizzes!.map(quiz => {
                    const attempts = (session.quiz_attempts ?? []).filter(a => (a as any).quiz_id === quiz.id)
                    const passed   = attempts.find(a => a.passed)
                    return (
                      <div key={quiz.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[13px] font-semibold text-slate-800">{quiz.quiz_title}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-400">Pass: {quiz.pass_score}%</span>
                            {passed ? (
                              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                Passed {Number(passed.score).toFixed(0)}%
                              </span>
                            ) : attempts.length > 0 ? (
                              <span className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                                Failed
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                                Not started
                              </span>
                            )}
                          </div>
                        </div>
                        {attempts.length > 0 && (
                          <table className="w-full text-[12px] mt-2">
                            <thead>
                              <tr className="text-left text-[11px] text-slate-400 border-b border-slate-200">
                                <th className="pb-1.5 font-medium">Attempt</th>
                                <th className="pb-1.5 font-medium">Score</th>
                                <th className="pb-1.5 font-medium">Result</th>
                                <th className="pb-1.5 font-medium">Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {attempts.map(a => (
                                <tr key={a.id} className={cn('border-b border-slate-100 last:border-0', a.passed ? 'bg-emerald-50/30' : 'bg-red-50/30')}>
                                  <td className="py-1.5 text-slate-600">#{a.attempt_number}</td>
                                  <td className="py-1.5 text-slate-600">{Number(a.score).toFixed(0)}%</td>
                                  <td className="py-1.5">
                                    <span className={cn('text-[11px] font-semibold', a.passed ? 'text-emerald-700' : 'text-red-600')}>
                                      {a.passed ? 'PASS ✓' : 'FAIL ✗'}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-slate-400">{formatQualityDate(a.submitted_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[13px] text-slate-400 italic">No quizzes assigned</p>
              )}
            </Sub>


          </Section>}

          {/* ── Section 3: CSR Accountability (read-only) ───────────────────── */}
          {editSection !== 'actions-accountability' && <Section title="CSR Accountability" onEdit={canEdit ? () => startEdit('actions-accountability') : undefined}>

            {/* Action Plan */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Action Plan</p>
            {session.require_action_plan ? (
              <>
                <NoteBlock text={session.csr_action_plan} placeholder="Pending" />
                {session.csr_action_plan && (
                  <div className="mt-3 space-y-1">
                    {session.csr_root_cause && (
                      <p className="text-[12px] text-slate-500">
                        <span className="font-medium text-slate-600">Root cause:</span> {session.csr_root_cause}
                      </p>
                    )}
                    {session.csr_support_needed && (
                      <p className="text-[12px] text-slate-500">
                        <span className="font-medium text-slate-600">Support needed:</span> {session.csr_support_needed}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-slate-400">Not required</p>
            )}

            {/* Acknowledgment */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Acknowledgment</p>
              {session.require_acknowledgment ? (
                <NoteBlock
                  text={session.csr_acknowledged_at ? formatQualityDate(session.csr_acknowledged_at) : null}
                  placeholder="Pending"
                />
              ) : (
                <p className="text-[13px] text-slate-400">Not required</p>
              )}
            </div>

            {/* Timing — due dates govern when CSR must complete their work */}
            <Sub title="Timing">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Due Date</p>
                  {session.due_date ? (
                    <p className={cn('text-[13px] font-medium', session.is_overdue ? 'text-red-600' : 'text-slate-800')}>
                      {formatQualityDate(session.due_date)}{session.is_overdue ? ' ⚠' : ''}
                    </p>
                  ) : (
                    <p className="text-[13px] text-slate-400">Not set</p>
                  )}
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Follow-Up Date</p>
                  {session.follow_up_date ? (
                    <p className="text-[13px] font-medium text-slate-800">{formatQualityDate(session.follow_up_date)}</p>
                  ) : (
                    <p className="text-[13px] text-slate-400">Not set</p>
                  )}
                </div>
              </div>
              {(session.follow_up_required || !!session.follow_up_date) && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Follow-Up Notes</p>
                  <NoteBlock text={session.follow_up_notes} placeholder="No follow-up notes yet" />
                </div>
              )}
            </Sub>

          </Section>}

          {/* ── Section 4: Internal Notes (trainer/manager/admin only) ───── */}
          {canSeeInternal && editSection === 'internal' && (
            <>
              <InternalNotesSection form={formDraft} update={updateDraft} />
              <SectionEditBar onSave={() => sectionSaveMut.mutate()} onCancel={cancelEdit} saving={sectionSaveMut.isPending} showBatch={!!session?.batch_id} applyToBatch={applyToBatch} onToggleBatch={() => setApplyToBatch(v => !v)} />
            </>
          )}
          {canSeeInternal && editSection !== 'internal' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-700">Internal Notes</h3>
                  <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">Private — Not visible to CSR</span>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => startEdit('internal')}
                    className="flex items-center gap-1 text-slate-400 hover:text-primary transition-colors text-[12px]">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              <div className="p-5 space-y-5">
                {/* Behavior flags — first */}
                {(() => {
                  const flags = session.behavior_flags
                    ? session.behavior_flags.split(',').filter(Boolean)
                    : []
                  const allFlatFlags = BEHAVIOR_FLAG_GROUPS.flatMap(g => g.flags)
                  const selectedGroups = BEHAVIOR_FLAG_GROUPS
                    .map(g => ({ ...g, flags: g.flags.filter(f => flags.includes(f.value)) }))
                    .filter(g => g.flags.length > 0)
                  return (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Behavior Flags</p>
                      {selectedGroups.length === 0 ? (
                        <p className="text-[13px] text-slate-400 italic">No flags recorded</p>
                      ) : (
                        <div className="space-y-3">
                          {selectedGroups.map(g => (
                            <div key={g.label}>
                              <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1.5">{g.label}</p>
                              <ul className="space-y-1">
                                {g.flags.map(f => (
                                  <li key={f.value} className="flex items-center gap-2 text-[13px] text-slate-700">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                    {f.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Internal notes text — second */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Internal Notes</p>
                  <NoteBlock text={session.internal_notes} placeholder="No internal notes recorded" />
                </div>
              </div>
            </div>
          )}

          {/* ── Section 4: Attachment ────────────────────────────────────── */}
          {session.attachment_filename && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-700">Attachment</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-slate-600 truncate max-w-[240px]">{session.attachment_filename}</span>
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                  </Button>
                </div>
              </div>
            </div>
          )}


        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="col-span-1 space-y-4">

          {/* Status panel */}
          <SideCard>
            <SideTitle>Status</SideTitle>
            {session.status === 'CLOSED' ? (
              <p className="text-[12px] text-slate-400 italic">This session is closed and archived.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Current</p>
                  <p className="text-[13px] font-semibold text-slate-800">{STATUS_LABELS[session.status] ?? session.status}</p>
                </div>
                {/* Schedule — only when DRAFT, triggers CSR visibility + auto-status */}
                {session.status === 'SCHEDULED' && (
                  <div className="border-t border-slate-100 pt-3">
                    <Button
                      className="w-full bg-primary hover:bg-primary/90 text-white h-9 text-[13px] font-semibold"
                      onClick={() => deliverMut.mutate()}
                      disabled={deliverMut.isPending || statusMut.isPending}
                    >
                      {deliverMut.isPending ? 'Scheduling…' : 'Schedule Coaching Session'}
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
                    {(['SCHEDULED', 'IN_PROCESS', 'AWAITING_CSR_ACTION', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED'] as const).map(s => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}{s === 'CLOSED' ? ' (Final)' : ''}</option>
                    ))}
                  </select>
                  <Button
                    className={cn(
                      'w-full h-8 text-[12px]',
                      pendingStatus === 'CLOSED'
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-primary hover:bg-primary/90 text-white'
                    )}
                    disabled={pendingStatus === session.status || statusMut.isPending}
                    onClick={() => statusMut.mutate(pendingStatus)}
                  >
                    {statusMut.isPending ? 'Updating…'
                      : pendingStatus === 'CLOSED' ? 'Close Session'
                      : 'Update Status'}
                  </Button>
                </div>
              </div>
            )}
          </SideCard>

          {/* CSR Response summary */}
          <SideCard>
            <SideTitle>CSR Response</SideTitle>
            <ResponseRow label="Session Scheduled"
              value={session.delivered_at
                ? formatQualityDate(session.delivered_at)
                : <span className="text-slate-400">—</span>} />
            <ResponseRow label="Action Plan"
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
            <ResponseRow label="Acknowledged"
              muted={!session.require_acknowledgment}
              value={session.csr_acknowledged_at
                ? <span className="text-slate-700">{formatQualityDate(session.csr_acknowledged_at)}</span>
                : <span className={session.require_acknowledgment ? 'text-amber-600' : 'text-slate-400'}>
                    {session.require_acknowledgment ? 'Pending' : 'Not required'}
                  </span>} />
            <ResponseRow label="Quiz Passed" value={<QuizSummary session={session} />} />
          </SideCard>

          {/* Prior Sessions */}
          <SideCard>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Prior Sessions</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{session.csr_name}</p>
              </div>
              {recentSessions.length > 0 && (
                <button type="button" onClick={() => setShowHistory(true)}
                  className="text-[12px] text-primary hover:underline shrink-0">
                  View all →
                </button>
              )}
            </div>

            {recentSessions.length === 0 ? (
              <p className="text-[13px] text-slate-400">First session with this CSR</p>
            ) : (
              <div className="space-y-0">
                {recentSessions.map(s => (
                  <div key={s.id} className="grid grid-cols-[80px_1fr] gap-4 py-3 border-b border-slate-100 last:border-0 items-start">
                    <span className="text-[11px] text-slate-400 pt-0.5 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </span>
                    <TopicList topics={s.topics} />
                  </div>
                ))}
              </div>
            )}

            {(session.repeat_topics?.length ?? 0) > 0 && (
              <div className="mt-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Coached 2+ times in 90 days
                </p>
                <ul className="space-y-1 pl-3">
                  {session.repeat_topics!.map(t => (
                    <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SideCard>

        </div>
      </div>

      {/* ── Prior Sessions Modal ───────────────────────────────────────────── */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>All Sessions — {session.csr_name}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 pr-1">
            {recentSessions.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-4 text-center">No prior sessions</p>
            ) : (
              <div className="space-y-0">
                {recentSessions.map(s => (
                  <div key={s.id} className="grid grid-cols-[90px_1fr] gap-6 py-3 border-b border-slate-100 last:border-0 items-start">
                    <span className="text-[11px] text-slate-400 pt-0.5 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </span>
                    <TopicList topics={s.topics} />
                  </div>
                ))}
              </div>
            )}
            {(session.repeat_topics?.length ?? 0) > 0 && (
              <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Coached 2+ times in 90 days
                </p>
                <ul className="space-y-1 pl-3">
                  {session.repeat_topics!.map(t => (
                    <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-slate-100">
            <Button variant="outline" size="sm" className="w-full text-[13px]"
              onClick={() => { setShowHistory(false); navigate(`/app/training/coaching?csrs=${encodeURIComponent(session.csr_name)}`) }}>
              Open Full Coaching List for {session.csr_name} →
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}
