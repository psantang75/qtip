import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Target, CheckCircle, HelpCircle, Paperclip, Download, BookOpen, ChevronRight, ChevronDown } from 'lucide-react'
import { QuizPlayer } from '@/components/training/QuizPlayer'
import trainingService, { type CoachingSourceType } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { PURPOSE_MAP, FORMAT_MAP, STATUS_LABELS } from './CoachingSessionsPage'

import { Section, Sub, InfoRow, NoteBlock, SideCard, SideTitle, ProgressRow } from './training-detail/layout'

// ── Source labels ─────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<CoachingSourceType, string> = {
  QA_AUDIT: 'QA Audit', MANAGER_OBSERVATION: 'Manager Observation', TREND: 'Trend',
  DISPUTE: 'Dispute', SCHEDULED: 'Scheduled', OTHER: 'Other',
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyCoachingDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()
  const { user }  = useAuth()

  const [actionPlan,    setActionPlan]    = useState('')
  const [rootCause,     setRootCause]     = useState('')
  const [supportNeeded, setSupportNeeded] = useState('')
  const [acknowledged,  setAcknowledged]  = useState(false)
  const [passedQuizIds,   setPassedQuizIds]   = useState<Set<number>>(new Set())
  const [expandedQuizIds, setExpandedQuizIds] = useState<Set<number>>(new Set())

  const toggleQuizExpand = (quizId: number) =>
    setExpandedQuizIds(prev => {
      const next = new Set(prev)
      next.has(quizId) ? next.delete(quizId) : next.add(quizId)
      return next
    })

  const { data: session, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-coaching-detail', id],
    queryFn:  () => trainingService.getMyCoachingDetail(Number(id)),
    enabled:  !!id,
  })

  useEffect(() => {
    if (!session) return
    setActionPlan(session.csr_action_plan ?? '')
    setRootCause(session.csr_root_cause ?? '')
    setSupportNeeded(session.csr_support_needed ?? '')
    setAcknowledged(!!session.csr_acknowledged_at)
    const passed = new Set<number>(
      (session.quiz_attempts ?? [])
        .filter(a => a.passed)
        .map(a => a.quiz_id as number)
        .filter(Boolean)
    )
    setPassedQuizIds(passed)
  }, [session])

  const submitMut = useMutation({
    mutationFn: () => trainingService.submitCSRResponse(Number(id), {
      action_plan:    actionPlan,
      root_cause:     rootCause     || undefined,
      support_needed: supportNeeded || undefined,
      acknowledged,
    }),
    onSuccess: () => {
      toast({ title: 'Response submitted!' })
      qc.invalidateQueries({ queryKey: ['my-coaching-detail', id] })
      qc.invalidateQueries({ queryKey: ['my-coaching'] })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (err: any) =>
      toast({ title: 'Submit failed', description: err?.message ?? 'Please try again.', variant: 'destructive' }),
  })

  const handleDownload = async () => {
    if (!session?.attachment_filename) return
    try {
      const blob = URL.createObjectURL(await trainingService.downloadAttachment(Number(id)))
      const a = Object.assign(document.createElement('a'), { href: blob, download: session.attachment_filename })
      a.click(); URL.revokeObjectURL(blob)
    } catch { toast({ title: 'Download failed', variant: 'destructive' }) }
  }

  if (isLoading) return <QualityListPage><TableLoadingSkeleton rows={8} /></QualityListPage>
  if (isError || !session) return <QualityListPage><TableErrorState message="Failed to load training session." onRetry={refetch} /></QualityListPage>

  const { status, require_action_plan, require_acknowledgment } = session
  const quizzes          = session.quizzes ?? []
  const isReadOnly       = ['COMPLETED', 'CLOSED'].includes(status)
  const isScheduled      = status === 'SCHEDULED'
  const alreadySubmitted = !!session.csr_action_plan

  const planOk         = !require_action_plan || (actionPlan.length >= 50) || alreadySubmitted
  const ackOk          = !require_acknowledgment || acknowledged || !!session.csr_acknowledged_at
  const needsPlanOrAck = require_action_plan || require_acknowledgment
  // Quizzes are independent — CSR submits plan/ack separately; quiz pass triggers auto-advance on its own
  const isFormComplete  = planOk && ackOk

  const progressItems: { label: string }[] = [
    ...(require_action_plan   ? [{ label: 'Submit your action plan' }] : []),
    ...(require_acknowledgment ? [{ label: 'Acknowledge the training session' }] : []),
    ...(quizzes.length > 0    ? [{ label: 'Complete the assigned quiz' }] : []),
  ]



  return (
    <QualityListPage>
      <QualityPageHeader
        title="Training Session"
        actions={
          <Button variant="outline" onClick={() => navigate('/app/training/my-coaching')}>← Back</Button>
        }
      />

      {/* Banners */}
      {isScheduled && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-[13px] font-medium text-slate-700">
            Your training session is scheduled. Notes and any required actions will be shared after your meeting.
          </p>
          {progressItems.length > 0 && (
            <div className="text-[12px] text-slate-500 space-y-1 pt-2 mt-2 border-t border-slate-200">
              <p className="font-medium text-slate-600">After the meeting, you may need to:</p>
              {progressItems.map(i => <p key={i.label}>→ {i.label}</p>)}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">

          {/* Section 1 — Session (same layout as trainer) */}
          <Section title="Session">
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoRow label="Coach"            value={session.created_by_name} />
              <InfoRow label="Session Date"     value={formatQualityDate(session.session_date)} />
              <InfoRow label="Coaching Purpose" value={PURPOSE_MAP[session.coaching_purpose] ?? session.coaching_purpose} />
              <InfoRow label="Coaching Source"  value={SOURCE_LABELS[session.source_type] ?? session.source_type} />
              <InfoRow label="Coaching Format"  value={FORMAT_MAP[session.coaching_format] ?? session.coaching_format} />
            </div>
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Topics</p>
              <TopicList topics={session.topics} />
            </div>
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
              <NoteBlock text={session.notes} placeholder="No notes provided" />
            </div>
          </Section>

          {/* Section 2 — Required Actions */}
          <Section title="Required Actions">

            {/* Required action */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Required Action Notes</p>
            <NoteBlock text={session.required_action} placeholder="No required action specified" />

            {/* Reference Materials */}
            <Sub title="Reference Materials" icon={BookOpen}>
              {(session.kb_resources?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {session.kb_resources!.map(r => (
                    <div key={r.id} className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-slate-900 truncate">{r.title}</p>
                        {r.description && <p className="text-[12px] text-slate-500 mt-0.5">{r.description}</p>}
                      </div>
                      <a
                        href={r.resource_type === 'URL' && r.url ? r.url : r.url ? r.url : `/api/csr/resources/${r.id}/file`}
                        target="_blank" rel="noopener noreferrer"
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
            <Sub title="Quizzes" icon={HelpCircle}>
              {quizzes.length > 0 ? (
                <div className="space-y-3">
                  {quizzes.map(quiz => {
                    const attempts    = (session.quiz_attempts ?? []).filter(a => a.quiz_id === quiz.id)
                    const quizPassed  = passedQuizIds.has(quiz.id) || attempts.some(a => a.passed)
                    const bestScore   = attempts.length > 0 ? Math.max(...attempts.map(a => Number(a.score))) : null
                    const isExpanded  = expandedQuizIds.has(quiz.id)
                    const hasAttempts = attempts.length > 0

                    return (
                      <div key={quiz.id} className="rounded-lg border border-slate-200 overflow-hidden">

                        {/* Accordion header */}
                        <button
                          type="button"
                          onClick={() => toggleQuizExpand(quiz.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                        >
                          {isExpanded
                            ? <ChevronDown  className="h-4 w-4 text-slate-400 shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                          }
                          <span className="text-[14px] font-semibold text-slate-900 flex-1 truncate">
                            {quiz.quiz_title}
                          </span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[12px] text-slate-500">
                              {attempts.length} attempt{attempts.length !== 1 ? 's' : ''}
                            </span>
                            {quizPassed
                              ? <span className="text-[13px] text-slate-500">Passed</span>
                              : <span className="text-[11px] text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">Pass: {quiz.pass_score}%</span>
                            }
                          </div>
                        </button>

                        {/* Accordion body */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-3 space-y-4 bg-white">

                            {/* Attempt history */}
                            {hasAttempts && (
                              <div>
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Attempt History</p>
                                <Table className="text-[12px]">
                                  <TableHeader>
                                    <TableRow className="border-slate-100">
                                      <TableHead className="h-7 py-0 text-[11px] text-slate-400 font-medium">Attempt</TableHead>
                                      <TableHead className="h-7 py-0 text-[11px] text-slate-400 font-medium">Score</TableHead>
                                      <TableHead className="h-7 py-0 text-[11px] text-slate-400 font-medium">Result</TableHead>
                                      <TableHead className="h-7 py-0 text-[11px] text-slate-400 font-medium">Date</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {attempts.map(a => (
                                      <TableRow key={a.id} className="border-slate-50">
                                        <TableCell className="py-1.5 text-slate-600">#{a.attempt_number}</TableCell>
                                        <TableCell className="py-1.5 text-slate-600">{Number(a.score).toFixed(0)}%</TableCell>
                                        <TableCell className="py-1.5 text-slate-600">
                                          {a.passed ? 'Passed' : 'Not passed'}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-slate-400">{formatQualityDate(a.submitted_at)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}

                            {/* Review — only shown after at least one attempt */}
                            {hasAttempts && quiz.questions?.length > 0 && (() => {
                              // Use the most recent attempt's answers
                              const lastAttempt = attempts[attempts.length - 1]
                              const answerMap = new Map<number, number>()
                              try {
                                const parsed = JSON.parse(lastAttempt?.answers_json ?? '[]')
                                parsed.forEach((a: { question_id: number; selected_option: number }) =>
                                  answerMap.set(a.question_id, a.selected_option)
                                )
                              } catch { /* ignore parse errors */ }
                              return (
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                                    Your Answers — Attempt #{lastAttempt.attempt_number}
                                  </p>
                                  <div className="space-y-4">
                                    {quiz.questions.map((q: any, qi: number) => {
                                      const userAnswer = answerMap.get(q.id)
                                      const answeredCorrectly = userAnswer === q.correct_option
                                      return (
                                        <div key={q.id}>
                                          <p className="text-[13px] font-medium text-slate-700 mb-2">
                                            {qi + 1}. {q.question_text}
                                          </p>
                                          <div className="space-y-1 pl-3">
                                            {q.options.map((opt: string, oi: number) => {
                                              const isUserAnswer  = oi === userAnswer
                                              const isCorrect     = oi === q.correct_option
                                              // Show: user's answer (right or wrong) + correct answer if user was wrong
                                              const show = isUserAnswer || (!answeredCorrectly && isCorrect)
                                              if (!show && userAnswer !== undefined) return null
                                              return (
                                                <div key={oi} className={cn(
                                                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px]',
                                                  isUserAnswer && answeredCorrectly ? 'bg-emerald-50 text-emerald-800 font-medium' :
                                                  isUserAnswer && !answeredCorrectly ? 'bg-red-50 text-red-800 font-medium' :
                                                  isCorrect ? 'bg-slate-50 text-slate-600 font-medium' : 'text-slate-500'
                                                )}>
                                                  <span className="text-[11px] shrink-0 w-4">
                                                    {isUserAnswer && answeredCorrectly ? '✓' :
                                                     isUserAnswer && !answeredCorrectly ? '✗' :
                                                     isCorrect ? '→' : ''}
                                                  </span>
                                                  <span>{String.fromCharCode(65 + oi)}. {opt}</span>
                                                  {isCorrect && !answeredCorrectly && (
                                                    <span className="text-[11px] text-slate-400 ml-1">(correct)</span>
                                                  )}
                                                </div>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })()}

                            {/* Take Quiz / Retake if score < 100% */}
                            {!isReadOnly && (bestScore === null || bestScore < 100) && (
                              <div className="border-t border-slate-100 pt-4">
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                                  {attempts.length === 0 ? 'Take Quiz' : 'Retake Quiz'}
                                </p>
                                <QuizPlayer
                                  quiz={quiz}
                                  coachingSessionId={session.id}
                                  onPassed={() => {
                                    setPassedQuizIds(prev => new Set([...prev, quiz.id]))
                                    qc.invalidateQueries({ queryKey: ['my-coaching-detail', id] })
                                    qc.invalidateQueries({ queryKey: ['my-coaching'] })
                                  }}
                                />
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[13px] text-slate-400 italic">No quizzes assigned</p>
              )}
            </Sub>

          </Section>

          {/* Section 3 — CSR Accountability */}
          <Section title="CSR Accountability">

            {/* Action Plan */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Action Plan</p>
            {require_action_plan ? (
              alreadySubmitted ? (
                /* Submitted — same NoteBlock style as Notes and Required Action Notes */
                <div className="space-y-4">
                  <NoteBlock text={session.csr_action_plan} placeholder="" />
                  {(session.csr_root_cause || session.csr_support_needed) && (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3 pt-3 border-t border-slate-100">
                      {session.csr_root_cause && (
                        <InfoRow label="Root Cause" value={session.csr_root_cause} />
                      )}
                      {session.csr_support_needed && (
                        <InfoRow label="Support Needed" value={session.csr_support_needed} />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Not yet submitted — form inputs */
                <div className="space-y-3">
                  <div className="text-[12px] text-slate-400 space-y-0.5">
                    <p>→ What caused this issue?</p>
                    <p>→ What will you do differently going forward?</p>
                    <p>→ What support do you need, if any?</p>
                  </div>
                  <RichTextEditor className="text-[13px]"
                    placeholder="Write your response here… (50 characters minimum)"
                    value={actionPlan}
                    onChange={setActionPlan} />
                  <p className={cn('text-[11px]', actionPlan.length < 50 ? 'text-red-500' : 'text-slate-400')}>
                    {actionPlan.length}/1000{actionPlan.length < 50 && ` (${50 - actionPlan.length} more needed)`}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Root Cause (optional)</label>
                      <Input className="h-9 text-[13px]" placeholder="e.g. Misunderstood policy"
                        value={rootCause} onChange={e => setRootCause(e.target.value)} disabled={isReadOnly} />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Support Needed (optional)</label>
                      <Input className="h-9 text-[13px]" placeholder="e.g. Additional training"
                        value={supportNeeded} onChange={e => setSupportNeeded(e.target.value)} disabled={isReadOnly} />
                    </div>
                  </div>
                </div>
              )
            ) : (
              <p className="text-[13px] text-slate-400">Not required</p>
            )}

            {/* Acknowledgment */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Acknowledgment</p>
              {require_acknowledgment ? (
                session.csr_acknowledged_at ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <CheckCircle className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="text-[13px]">
                      Acknowledged on {formatQualityDate(session.csr_acknowledged_at)} by {user?.username ?? 'you'}
                    </span>
                  </div>
                ) : (
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox"
                      checked={acknowledged}
                      disabled={isReadOnly}
                      onChange={e => setAcknowledged(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-primary" />
                    <span className="text-[13px] text-slate-700">
                      I have reviewed this training session, understand the feedback, and commit to the actions outlined.
                    </span>
                  </label>
                )
              ) : (
                <p className="text-[13px] text-slate-400">Not required</p>
              )}
            </div>

          </Section>

          {/* Section 4 — Attachment */}
          {session.attachment_filename && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-slate-400" />
                  <span className="text-[15px] font-semibold text-slate-800">Attachment</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-slate-600 truncate max-w-[220px]">{session.attachment_filename}</span>
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

          {/* Current Status */}
          <SideCard>
            <SideTitle>Status</SideTitle>
            <div>
              <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Current</p>
              <p className="text-[14px] font-semibold text-slate-900">{STATUS_LABELS[session.status] ?? session.status}</p>
            </div>
          </SideCard>

          {/* Your Progress — same format as trainer's CSR Response panel */}
          <SideCard>
            <SideTitle>Your Progress</SideTitle>

            <ProgressRow
              label="Session Scheduled"
              value={session.delivered_at
                ? formatQualityDate(session.delivered_at)
                : <span className="text-slate-400">—</span>}
            />

            {require_action_plan && (
              <ProgressRow
                label="Action Plan"
                value={session.csr_action_plan
                  ? <span className="text-slate-700">
                      {session.csr_acknowledged_at
                        ? formatQualityDate(session.csr_acknowledged_at)
                        : 'Submitted'}
                    </span>
                  : <span className="text-amber-600">Pending</span>}
              />
            )}

            {require_acknowledgment && (
              <ProgressRow
                label="Acknowledged"
                value={session.csr_acknowledged_at
                  ? <span className="text-slate-700">{formatQualityDate(session.csr_acknowledged_at)}</span>
                  : <span className="text-amber-600">Pending</span>}
              />
            )}

            {quizzes.map(quiz => {
              const attempts   = (session.quiz_attempts ?? []).filter(a => a.quiz_id === quiz.id)
              const passed     = passedQuizIds.has(quiz.id) || attempts.find(a => a.passed)
              const passedAttempt = attempts.find(a => a.passed)
              return (
                <ProgressRow
                  key={quiz.id}
                  label={quiz.quiz_title}
                  value={passed
                    ? <span className="text-slate-700">
                        {passedAttempt ? formatQualityDate(passedAttempt.submitted_at) : 'Passed'}
                      </span>
                    : attempts.length > 0
                      ? <span className="text-amber-600">
                          Failed — best {Math.max(...attempts.map(a => Number(a.score))).toFixed(0)}%
                        </span>
                      : <span className="text-amber-600">Not started</span>}
                />
              )
            })}

            {!require_action_plan && !require_acknowledgment && quizzes.length === 0 && (
              <p className="text-[12px] text-slate-400 italic">No required actions</p>
            )}
          </SideCard>


          {/* Session dates */}
          <SideCard>
            <SideTitle>Session Dates</SideTitle>
            <div className="space-y-0">
              <div className="flex items-start justify-between gap-2 py-2 border-b border-slate-50">
                <span className="text-[12px] text-slate-500">Scheduled</span>
                <span className="text-[12px] text-slate-700">
                  {session.delivered_at ? formatQualityDate(session.delivered_at) : <span className="text-slate-400">—</span>}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2 py-2 border-b border-slate-50">
                <span className="text-[12px] text-slate-500">Due Date</span>
                <span className="text-[12px] text-slate-700">
                  {session.due_date ? formatQualityDate(session.due_date) : <span className="text-slate-400">—</span>}
                </span>
              </div>
              {session.follow_up_date && (
                <div className="flex items-start justify-between gap-2 py-2">
                  <span className="text-[12px] text-slate-500">Follow-Up</span>
                  <span className="text-[12px] text-slate-700">{formatQualityDate(session.follow_up_date)}</span>
                </div>
              )}
            </div>
          </SideCard>

        </div>
      </div>

      {/* ── Bottom action bar — aligned with left column only ────────────── */}
      {!isReadOnly && !isScheduled && needsPlanOrAck && (
        <div className="grid grid-cols-3 gap-6 mt-2">
        <div className="col-span-2">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
          <Button variant="outline" onClick={() => navigate('/app/training/my-coaching')}>
            Cancel
          </Button>
          <div className="flex items-center gap-3">
            <Button
              className={cn(
                'text-[13px] font-semibold',
                isFormComplete
                  ? 'bg-primary hover:bg-primary/90 text-white'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              )}
              disabled={!isFormComplete || submitMut.isPending}
              onClick={() => submitMut.mutate()}
            >
              {submitMut.isPending ? 'Submitting…' : 'Submit Response'}
            </Button>
          </div>
        </div>
        </div>
        </div>
      )}
    </QualityListPage>
  )
}
