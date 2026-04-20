import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { QuizPlayer, QuizReview } from '@/components/training/QuizPlayer'
import trainingService from '@/services/trainingService'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
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

import { Section, InfoRow, NoteBlock, SideCard, SideTitle, ProgressRow, TopicList } from './training-detail/layout'
import { AttachmentCard } from '@/components/training/AttachmentCard'
import { ResourcesTable, QuizSummaryTable } from '@/components/training/ReadOnlySections'
import { downloadSessionAttachment } from '@/utils/trainingHelpers'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyCoachingDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()
  const { user }  = useAuth()

  const [actionPlan,    setActionPlan]    = useState('')
  const [acknowledged,  setAcknowledged]  = useState(false)
  const [passedQuizIds,   setPassedQuizIds]   = useState<Set<number>>(new Set())

  const { data: session, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-coaching-detail', id],
    queryFn:  () => trainingService.getMyCoachingDetail(Number(id)),
    enabled:  !!id,
  })

  useEffect(() => {
    if (!session) return
    setActionPlan(session.csr_action_plan ?? '')
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
    try { await downloadSessionAttachment(Number(id), session.attachment_filename) }
    catch { toast({ title: 'Download failed', variant: 'destructive' }) }
  }

  if (isLoading) return <div className="p-6"><TableLoadingSkeleton rows={8} /></div>
  if (isError || !session) return <div className="p-6"><TableErrorState message="Failed to load training session." onRetry={refetch} /></div>

  const { status } = session
  const require_action_plan    = !!session.require_action_plan
  const require_acknowledgment = !!session.require_acknowledgment
  const quizzes          = session.quizzes ?? []
  const isReadOnly       = ['COMPLETED', 'CLOSED', 'CANCELED'].includes(status)
  const isScheduled      = status === 'SCHEDULED'
  const alreadySubmitted = !!session.csr_action_plan

  const planOk         = !require_action_plan || (actionPlan.length >= 50) || alreadySubmitted
  const ackOk          = !require_acknowledgment || acknowledged || !!session.csr_acknowledged_at
  const needsPlanOrAck = require_action_plan || require_acknowledgment
  // Quizzes are independent — Agent submits plan/ack separately; quiz pass triggers auto-advance on its own
  const isFormComplete  = planOk && ackOk

  const progressItems: { label: string }[] = [
    ...(require_action_plan   ? [{ label: 'Submit your action plan' }] : []),
    ...(require_acknowledgment ? [{ label: 'Acknowledge the training session' }] : []),
    ...(quizzes.length > 0    ? [{ label: 'Complete the assigned quiz' }] : []),
  ]



  return (
    <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>

      <div className="shrink-0 px-6 pt-6 space-y-5">
        <QualityPageHeader
          title="Training Session"
          actions={
            <Button variant="outline" onClick={() => navigate('/app/training/my-coaching')}>← Back</Button>
          }
        />

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
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6 pt-5">
        <div className="grid grid-cols-3 gap-6 h-full">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="col-span-2 overflow-y-auto space-y-4 pr-2">

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
              <TopicList topics={session.topics} columns={3} bold />
            </div>
            <div className="border-t border-slate-100 pt-4 mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
              <NoteBlock text={session.notes} placeholder="No notes provided" bold />
            </div>
          </Section>

          {/* Section 2 — Required Actions */}
          <Section title="Required Actions">

            {/* Required action */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Required Action Notes</p>
            <NoteBlock text={session.required_action} placeholder="No required action specified" bold />

            <ResourcesTable resources={session.kb_resources ?? []} forAgent />

            <QuizSummaryTable
              quizzes={quizzes}
              attempts={session.quiz_attempts ?? []}
              renderAction={(quizId) => {
                const quiz = quizzes.find(q => q.id === quizId)
                if (!quiz) return null
                const qa = (session.quiz_attempts ?? []).filter(a => a.quiz_id === quizId)
                const alreadyPassed = passedQuizIds.has(quizId) || qa.some(a => a.passed)

                if (alreadyPassed) return <QuizReview quiz={quiz} defaultOpen />

                if (isReadOnly) return null

                return (
                  <QuizPlayer
                    quiz={quiz}
                    coachingSessionId={session.id}
                    onPassed={() => {
                      setPassedQuizIds(prev => new Set([...prev, quizId]))
                      qc.invalidateQueries({ queryKey: ['my-coaching-detail', id] })
                      qc.invalidateQueries({ queryKey: ['my-coaching'] })
                    }}
                  />
                )
              }}
            />

          </Section>

          {/* Section 3 — Agent Accountability */}
          <Section title="Agent Accountability">

            {/* Action Plan */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Action Plan</p>
            {require_action_plan ? (
              alreadySubmitted ? (
                <NoteBlock text={session.csr_action_plan} placeholder="" bold />
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

          {/* Attachment (always visible) */}
          <AttachmentCard
            filename={session.attachment_filename}
            onDownload={session.attachment_filename ? handleDownload : undefined}
          />

          {/* ── Bottom action bar ── */}
          {!isReadOnly && !isScheduled && needsPlanOrAck && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
              <Button variant="outline" onClick={() => navigate('/app/training/my-coaching')}>
                Cancel
              </Button>
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
          )}

          </div>

          {/* ── Right column ────────────────────────────────────────────────── */}
          <div className="col-span-1 overflow-y-auto space-y-4 pl-2">

          {/* Current Status */}
          <SideCard>
            <SideTitle>Status</SideTitle>
            <div>
              <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Current</p>
              <p className="text-[14px] font-semibold text-slate-900">{STATUS_LABELS[session.status] ?? session.status}</p>
            </div>
          </SideCard>

          {/* Your Progress — same format as trainer's Agent Response panel */}
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
      </div>

    </div>
  )
}
