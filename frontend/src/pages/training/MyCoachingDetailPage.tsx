import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Target, BookOpen, CheckCircle, ExternalLink, HelpCircle } from 'lucide-react'
import { QuizPlayer } from '@/components/training/QuizPlayer'
import trainingService from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const coachingLabel = (t: string) =>
  t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-slate-200 p-5', className)}>{children}</div>
}

function SectionTitle({
  icon: Icon, children,
}: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
      {Icon && <Icon className="h-4 w-4" />} {children}
    </h3>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyCoachingDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()

  const [actionPlan,    setActionPlan]    = useState('')
  const [rootCause,     setRootCause]     = useState('')
  const [supportNeeded, setSupportNeeded] = useState('')
  const [acknowledged,  setAcknowledged]  = useState(false)
  const [quizPassed,    setQuizPassed]    = useState(false)

  const { data: session, isLoading } = useQuery({
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
    setQuizPassed(session.quiz_attempts?.some(a => a.passed) ?? false)
  }, [session])

  const submitMut = useMutation({
    mutationFn: () => trainingService.submitCSRResponse(Number(id), {
      action_plan:     actionPlan,
      root_cause:      rootCause     || undefined,
      support_needed:  supportNeeded || undefined,
      acknowledged,
    }),
    onSuccess: () => {
      toast({ title: 'Response submitted!', description: 'Your coaching session has been completed.' })
      qc.invalidateQueries({ queryKey: ['my-coaching-detail', id] })
      qc.invalidateQueries({ queryKey: ['my-coaching'] })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (err: any) =>
      toast({ title: 'Submit failed', description: err?.message ?? 'Please try again.', variant: 'destructive' }),
  })

  if (isLoading || !session) {
    return <QualityListPage><TableLoadingSkeleton rows={8} /></QualityListPage>
  }

  const { status, require_action_plan, require_acknowledgment, quiz_required } = session
  const isReadOnly  = ['COMPLETED', 'CLOSED'].includes(status)
  const isScheduled = status === 'SCHEDULED'
  const alreadySubmittedPlan = !!session.csr_action_plan
  const planOk   = !require_action_plan || (actionPlan.length >= 50) || alreadySubmittedPlan
  const ackOk    = !require_acknowledgment || acknowledged || !!session.csr_acknowledged_at
  const quizOk   = !quiz_required || quizPassed
  const isFormComplete = planOk && ackOk && quizOk

  const tex = 'w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-primary/40'
  const inp = 'w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40'

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Coaching Session"
        subtitle={`${formatQualityDate(session.session_date)} · ${coachingLabel(session.coaching_purpose)} · ${coachingLabel(session.coaching_format)}`}
        actions={
          <Button variant="outline" onClick={() => navigate('/app/training/my-coaching')}>← Back</Button>
        }
      />

      {/* Status banners */}
      {isReadOnly && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          <span className="text-sm font-medium text-emerald-800">This session is complete. Your response is on record.</span>
        </div>
      )}
      {isScheduled && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
          <p className="text-[13px] font-medium text-slate-700">
            ℹ️ This session has not been delivered yet — check back soon.
          </p>
          {(!!require_action_plan || !!require_acknowledgment || !!quiz_required) && (
            <div className="text-[12px] text-slate-500 space-y-1 pt-1 border-t border-slate-200 mt-2">
              <p className="font-medium text-slate-600">Once delivered, you will need to:</p>
              {!!require_action_plan    && <p>→ Submit a written action plan (50+ characters)</p>}
              {!!require_acknowledgment && <p>→ Acknowledge you have reviewed the session</p>}
              {!!quiz_required          && <p>→ Complete the assigned quiz</p>}
            </div>
          )}
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-4">

        {/* Section 1 — Session Summary */}
        <Card>
          <SectionTitle icon={FileText}>Session Summary</SectionTitle>
          <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">
            {session.notes || <span className="text-slate-400">No notes provided</span>}
          </p>
          <p className="text-[12px] text-slate-400 mt-3">
            Shared by {session.created_by_name} · {formatQualityDate(session.session_date)}
          </p>
        </Card>

        {/* Section 2 — Required Action */}
        {session.required_action && (
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
            <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
              <Target className="h-4 w-4" /> What You Need to Do
            </h3>
            <p className="text-[13px] text-slate-800">{session.required_action}</p>
          </div>
        )}

        {/* Section 3 — Training Resource */}
        {(session.kb_resource || session.kb_url) && (
          <Card>
            <SectionTitle icon={BookOpen}>Review This Resource</SectionTitle>
            {session.kb_resource?.description && (
              <p className="text-[13px] text-slate-600 mb-3">{session.kb_resource.description}</p>
            )}
            <a
              href={session.kb_resource?.url ?? session.kb_url ?? '#'}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-[13px] font-medium hover:bg-primary/90 transition-colors"
            >
              Open Resource <ExternalLink className="h-4 w-4" />
            </a>
          </Card>
        )}

        {/* Section 4 — Your Action Plan */}
        {!!require_action_plan && (
          <Card>
            <SectionTitle>Your Response</SectionTitle>
            {alreadySubmittedPlan ? (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{session.csr_action_plan}</p>
                {session.csr_root_cause && (
                  <p className="text-[12px] text-slate-500 mt-2">Root cause: {session.csr_root_cause}</p>
                )}
                {session.csr_support_needed && (
                  <p className="text-[12px] text-slate-500">Support needed: {session.csr_support_needed}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-2">
                  Submitted {formatQualityDate(session.csr_acknowledged_at ?? session.session_date)}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1 text-[12px] text-slate-400">
                  <p>→ What caused this issue?</p>
                  <p>→ What will you do differently going forward?</p>
                  <p>→ What support do you need, if any?</p>
                </div>
                <textarea className={tex} rows={5} maxLength={1000}
                  placeholder="Write your response here…"
                  value={actionPlan}
                  onChange={e => setActionPlan(e.target.value)}
                  disabled={isReadOnly} />
                <p className={cn('text-[11px]', actionPlan.length < 50 ? 'text-red-500' : 'text-slate-400')}>
                  {actionPlan.length}/1000
                  {actionPlan.length < 50 && ` (${50 - actionPlan.length} more characters needed)`}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] text-slate-500 block mb-1">Root Cause (optional)</label>
                    <input className={inp} placeholder="e.g. Misunderstood policy"
                      value={rootCause} onChange={e => setRootCause(e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <label className="text-[12px] text-slate-500 block mb-1">Support Needed (optional)</label>
                    <input className={inp} placeholder="e.g. Additional training"
                      value={supportNeeded} onChange={e => setSupportNeeded(e.target.value)} disabled={isReadOnly} />
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Section 5 — Acknowledgment */}
        {!!require_acknowledgment && (
          <Card>
            {session.csr_acknowledged_at ? (
              <div className="flex items-center gap-3 text-emerald-700">
                <CheckCircle className="h-5 w-5" />
                <span className="text-[13px] font-medium">
                  Acknowledged on {formatQualityDate(session.csr_acknowledged_at)}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <label className={cn('flex items-start gap-3 cursor-pointer', (!planOk && !alreadySubmittedPlan) ? 'opacity-50 cursor-not-allowed' : '')}>
                  <input type="checkbox"
                    checked={acknowledged}
                    disabled={(!planOk && !alreadySubmittedPlan) || isReadOnly}
                    onChange={e => setAcknowledged(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-primary" />
                  <span className="text-[13px] text-slate-700">
                    I have reviewed this coaching session, understand the feedback, and commit to the actions outlined.
                  </span>
                </label>
                {!planOk && !alreadySubmittedPlan && (
                  <p className="text-[12px] text-amber-600 ml-6">Complete your action plan first</p>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Section 6 — Quiz */}
        {!!quiz_required && !!session.quiz && !quizPassed && !isReadOnly && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-slate-400" /> {session.quiz.quiz_title}
            </h3>
            {!planOk || !ackOk ? (
              <p className="text-[13px] text-amber-600">
                Complete your action plan and acknowledgment first to unlock the quiz.
              </p>
            ) : (
              <QuizPlayer
                quiz={session.quiz}
                coachingSessionId={session.id}
                onPassed={() => {
                  setQuizPassed(true)
                  qc.invalidateQueries({ queryKey: ['my-coaching-detail', id] })
                }}
              />
            )}
          </div>
        )}

        {/* Quiz passed badge */}
        {!!quiz_required && quizPassed && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
            <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-emerald-800">Quiz Passed</p>
              {session.quiz_attempts?.find(a => a.passed) && (
                <p className="text-[12px] text-emerald-600">
                  {Number(session.quiz_attempts!.find(a => a.passed)!.score).toFixed(0)}% · Attempt {session.quiz_attempts!.find(a => a.passed)!.attempt_number}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Submit button */}
        {!isReadOnly && !isScheduled && (
          <Button
            className={cn(
              'w-full py-3 text-base font-semibold',
              isFormComplete
                ? 'bg-primary hover:bg-primary/90 text-white'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed',
            )}
            disabled={!isFormComplete || submitMut.isPending}
            onClick={() => submitMut.mutate()}
          >
            {submitMut.isPending ? 'Submitting…' : 'Submit & Complete'}
          </Button>
        )}

      </div>
    </QualityListPage>
  )
}
