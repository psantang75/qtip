import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/utils/errorHandling'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Edit3, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useQualityRole } from '@/hooks/useQualityRole'
import qaService, { type SubmissionDetail, type MetadataEntry } from '@/services/qaService'
import { getFormById } from '@/services/formService'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  getQuestionScore,
  type FormRenderData,
} from '@/utils/forms'
import type { Form, Answer, FormMetadataField, FormQuestion } from '@/types/form.types'
import type { AiExtras } from '@/services/aiReviewerService'

interface SubmissionCall {
  call_id?: string
  call_date?: string
  recording_url?: string | null
  transcript?: string | null
}

type SubmissionDetailWithForm = SubmissionDetail & {
  formData?: Form
  calls?: SubmissionCall[]
  ticket_tasks?: Array<{ kind: 'TICKET' | 'TASK'; external_id: number; sort_order: number }>
  submitted_at?: string | Date
  /**
   * AI side outputs persisted in submissions.ai_extras. `answer_evidence`
   * is the per-question evidence map zipped with question text below.
   */
  ai_extras?: (AiExtras & {
    answer_evidence?: Record<string, { evidence_source?: string; evidence_quote?: string }>
  }) | null
}

/**
 * Phase C (C6): pull the per-answer evidence_source / evidence_quote
 * pairs out of submissions.ai_extras.answer_evidence and zip them with
 * the question text from formData so the AnswerEvidencePanel can show
 * the question alongside its supporting quote. Returns [] when neither
 * data source is present.
 */
function buildAnswerEvidenceEntries(detail: SubmissionDetailWithForm): AnswerEvidenceEntry[] {
  const evidence = detail.ai_extras?.answer_evidence
  if (!evidence) return []
  const qText = new Map<number, string>()
  for (const cat of detail.formData?.categories ?? []) {
    for (const q of cat.questions ?? []) {
      if (q?.id != null) qText.set(Number(q.id), String(q.question_text ?? ''))
    }
  }
  const out: AnswerEvidenceEntry[] = []
  for (const [qid, val] of Object.entries(evidence)) {
    const id = Number(qid)
    if (!Number.isInteger(id)) continue
    out.push({
      question_id: id,
      question_text: qText.get(id) ?? null,
      evidence_source: val?.evidence_source ?? null,
      evidence_quote: val?.evidence_quote ?? null,
    })
  }
  return out
}
import { useToast } from '@/hooks/use-toast'
import { DisputeForm } from './submission-detail/DisputeForms'
import { SubmissionHeader } from './submission-detail/SubmissionHeader'
import { ReviewDetailsPanel } from './submission-detail/ReviewDetailsPanel'
import { DisputePanel, type ResolutionState } from './submission-detail/DisputePanel'
import { CallDetailsPanel } from './submission-detail/CallDetailsPanel'
import { TicketTaskDetailsPanel } from './submission-detail/TicketTaskDetailsPanel'
import { ScorePanel } from './submission-detail/ScorePanel'
import { UnlockDialog } from './submission-detail/UnlockDialog'
import { UnlockBanner, type ActiveUnlock } from './submission-detail/UnlockBanner'
import { ReopenedNotice, type LastReopen } from './submission-detail/ReopenedNotice'
import { TimelinePanel } from '@/components/quality/ai/TimelinePanel'
import { AdvisoryObservationsPanel, type AdvisoryObservation } from '@/components/quality/ai/AdvisoryObservationsPanel'
import { AnswerEvidencePanel, type AnswerEvidenceEntry } from '@/components/quality/ai/AnswerEvidencePanel'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export default function SubmissionDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useAuth()
  const qc        = useQueryClient()
  const { toast } = useToast()

  const backLabel = (location.state as { from?: string } | null)?.from ?? 'Submissions'
  const { roleId, isAdmin, isAgent, isManager, canResolveDispute } = useQualityRole()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showDisputeForm, setShowDisputeForm] = useState(false)
  const [finalizeSuccess, setFinalizeSuccess] = useState(false)
  const [editingDispute,  setEditingDispute]  = useState(false)
  const [unlockTarget,    setUnlockTarget]    = useState<'SUBMISSION' | 'DISPUTE' | null>(null)

  // Resolution mode state
  const [resolutionMode, setResolutionMode] = useState(false)
  const [resNotes,       setResNotes]       = useState('')
  const [resError,       setResError]       = useState<string | null>(null)
  const [resSubmitting,  setResSubmitting]  = useState(false)
  const [editedAnswers,  setEditedAnswers]  = useState<Record<number, Answer>>({})
  const [editRenderData, setEditRenderData] = useState<FormRenderData | null>(null)
  const [liveScore,      setLiveScore]      = useState(0)

  // ── Data fetch ────────────────────────────────────────────────────────────
  const { data: detail, isLoading, isError } = useQuery<SubmissionDetailWithForm | null>({
    queryKey: ['submission-detail', id, roleId],
    queryFn: async () => {
      if (!id) return null
      const submission = isAgent
        ? await qaService.getCSRAuditDetail(Number(id))
        : isManager
        ? await qaService.getTeamAuditDetail(Number(id))
        : await qaService.getSubmissionDetail(Number(id))
      if (submission?.form_id) {
        try {
          const formData = await getFormById(submission.form_id, true)
          ;(submission as SubmissionDetailWithForm).formData = formData
        } catch { /* fall back to basic view */ }
      }
      return submission
    },
    enabled: !!id && !!user,
  })

  // ── Agent finalize ───────────────────────────────────────────────────────
  const { mutate: finalize, isPending: finalizing } = useMutation({
    mutationFn: () => qaService.finalizeCSRReview(Number(id)),
    onSuccess: () => {
      setFinalizeSuccess(true)
      qc.invalidateQueries({ queryKey: ['submission-detail', id] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
    },
    onError: () => toast({
      variant: 'destructive',
      title: "Couldn't accept review",
      description: 'Try again.',
    }),
  })

  // Pages that finish a job and send the reader here — the correction
  // re-submit, for one — pass their confirmation in router state. Announce it
  // once: the state outlives re-renders, and StrictMode mounts twice in dev.
  const announced = useRef(false)
  useEffect(() => {
    const message = (location.state as { message?: string } | null)?.message
    if (!message || announced.current) return
    announced.current = true
    toast({ title: message })
  }, [location.state, toast])

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-100 animate-pulse rounded-xl" />)}
      </div>
    )
  }
  if (isError || !detail) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
          Couldn't load this submission. Refresh to try again.
        </div>
      </div>
    )
  }

  const formData    = detail.formData
  const calls       = detail.calls
  const ticketTasks = detail.ticket_tasks ?? []
  const auditAt     = detail.submitted_at ? String(detail.submitted_at) : null
  const score       = typeof detail.score === 'string' ? parseFloat(detail.score) || 0 : Number(detail.score) || 0

  const canDispute      = isAgent && detail.status === 'SUBMITTED' && !detail.dispute
  const canAcceptReview = isAgent && detail.status !== 'FINALIZED' && detail.status !== 'DISPUTED' && detail.status !== 'RESOLVED'

  // ── Admin unlock ──────────────────────────────────────────────────────────
  const activeUnlock = (detail as SubmissionDetailWithForm & { active_unlock?: ActiveUnlock | null }).active_unlock ?? null
  // History rather than live state: the most recent finished reopen, shown so
  // the record itself says it was corrected and what the score used to be.
  const lastReopen = (detail as SubmissionDetailWithForm & { last_reopen?: LastReopen | null }).last_reopen ?? null
  // Only offer a reopen when there isn't already one in flight, and only for
  // the states the service will actually accept.
  // A disputed review is re-decided through the dispute, not by reopening the
  // form: reopening the form would drop it to DRAFT and put the whole audit
  // back in play when all that is wanted is an edit to the dispute.
  const canReopenReview = isAdmin && !activeUnlock && !detail.dispute
    && (detail.status === 'SUBMITTED' || detail.status === 'FINALIZED')
  const canReopenDispute = isAdmin && !activeUnlock
    && ['UPHELD', 'REJECTED', 'ADJUSTED'].includes(detail.dispute?.status ?? '')
  // The reviewer whose work it is drives the correction; admins can step in.
  // The DRAFT check keeps a stale payload from offering a correction the
  // server will reject: once the re-submit lands, the review is SUBMITTED
  // again and the draft endpoint answers 409.
  const canResumeDraft = activeUnlock?.entity_type === 'SUBMISSION'
    && detail.status === 'DRAFT'
    && (isAdmin || detail.reviewer_name === user?.username)

  const onUnlockSuccess = () => {
    toast({ title: 'Record reopened', description: 'Everyone involved has been notified.' })
    qc.invalidateQueries({ queryKey: ['submission-detail', id] })
    qc.invalidateQueries({ queryKey: ['submissions'] })
    qc.invalidateQueries({ queryKey: ['disputes'] })
    qc.invalidateQueries({ queryKey: ['manager-disputes'] })
  }

  // Build read-only answers map for ScoreRenderer
  const answersMap: Record<number, { answer: string; score?: number; notes: string }> = {}
  ;(detail.answers ?? []).forEach((a) => {
    if (a.question_id) answersMap[a.question_id] = { answer: a.answer, score: a.score, notes: '' }
  })

  // ── Build review details fields ───────────────────────────────────────────
  const fmtMetaValue = (name: string, raw: string) => {
    if (/date/i.test(name) && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-')
      return new Date(Number(y), Number(m) - 1, Number(d))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    return raw
  }
  const metaRows = Array.isArray(detail.metadata)
    ? (detail.metadata as MetadataEntry[]).map((m: MetadataEntry) => {
        const name = m.field_name ?? ''
        return { field_name: name, value: fmtMetaValue(name, String(m.value ?? '')), field_type: (m as MetadataEntry & { field_type?: string }).field_type }
      })
    : Object.entries(detail.metadata ?? {}).map(([k, v]) => {
        const val = typeof v === 'object' ? String((v as { value?: string }).value ?? '') : String(v)
        return { field_name: k, value: fmtMetaValue(k, val), field_type: undefined as string | undefined }
      })

  const metaValueMap = new Map(metaRows.map(r => [r.field_name.toLowerCase(), r.value] as [string, string]))
  const reviewDetailsFields = formData?.metadata_fields
    ? [...formData.metadata_fields]
        .sort((a: FormMetadataField, b: FormMetadataField) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((f: FormMetadataField) => ({
          field_name: f.field_name ?? '',
          field_type: f.field_type ?? 'TEXT',
          value: metaValueMap.get((f.field_name ?? '').toLowerCase()) ?? '',
        }))
    : metaRows.map(r => ({ field_name: r.field_name, field_type: r.field_type ?? 'TEXT', value: r.value }))

  const firstSpacerIdx    = reviewDetailsFields.findIndex(f => f.field_type === 'SPACER')
  const topReviewFields   = firstSpacerIdx >= 0 ? reviewDetailsFields.slice(0, firstSpacerIdx)  : reviewDetailsFields
  const bottomReviewFields = firstSpacerIdx >= 0 ? reviewDetailsFields.slice(firstSpacerIdx + 1) : []
  const hasBottomReviewFields = bottomReviewFields.some(f => f.field_type !== 'SPACER')

  // ── Score display ─────────────────────────────────────────────────────────
  const prevScore     = detail.dispute?.previous_score != null ? Number(detail.dispute.previous_score) : null
  const adjScore      = detail.dispute?.new_score       != null ? Number(detail.dispute.new_score)      : null
  const disputeAdjusted = detail.dispute?.status === 'ADJUSTED' && prevScore != null && adjScore != null

  // ── Resolution mode handlers ──────────────────────────────────────────────
  const enterResolutionMode = () => {
    if (!formData) return
    const initial: Record<number, Answer> = {}
    ;(detail.answers ?? []).forEach((a) => {
      if (a.question_id) initial[a.question_id] = { question_id: a.question_id, answer: a.answer || '', score: a.score || 0, notes: (a as { notes?: string }).notes || '' }
    })
    setEditedAnswers(initial)
    const { totalScore, categoryScores } = calculateFormScore(formData, initial)
    setLiveScore(totalScore)
    const ansStrings: Record<number, string> = {}
    Object.entries(initial).forEach(([k, v]) => { ansStrings[Number(k)] = v.answer || '' })
    const visibility = processConditionalLogic(formData, ansStrings)
    setEditRenderData(prepareFormForRender(formData, initial, visibility, categoryScores, totalScore, roleId))
    setResolutionMode(true)
  }

  const handleEditAnswer = (questionId: number, value: string) => {
    if (!formData) return
    let foundQ: FormQuestion | undefined
    for (const cat of formData.categories ?? []) {
      const q = cat.questions?.find((q) => q.id === questionId)
      if (q) { foundQ = q; break }
    }
    const qScore = foundQ ? getQuestionScore(foundQ, value) : 0
    const newAnswers = { ...editedAnswers, [questionId]: { question_id: questionId, answer: value, score: qScore, notes: editedAnswers[questionId]?.notes || '' } }
    setEditedAnswers(newAnswers)
    const { totalScore, categoryScores } = calculateFormScore(formData, newAnswers)
    setLiveScore(totalScore)
    const ansStrings: Record<number, string> = {}
    Object.entries(newAnswers).forEach(([k, v]) => { ansStrings[Number(k)] = v.answer || '' })
    const visibility = processConditionalLogic(formData, ansStrings)
    setEditRenderData(prepareFormForRender(formData, newAnswers, visibility, categoryScores, totalScore, roleId))
  }

  const submitResolution = async (action: 'UPHOLD' | 'ADJUST') => {
    if (!detail.dispute?.id) return
    if (!resNotes.trim()) { setResError('Resolution notes are required.'); return }
    setResError(null)
    setResSubmitting(true)
    try {
      await qaService.resolveDispute(detail.dispute.id, {
        resolution_action: action,
        resolution_notes:  resNotes,
        new_score: action === 'ADJUST' ? liveScore : undefined,
        answers:   action === 'ADJUST'
          ? Object.entries(editedAnswers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer ?? '', notes: a.notes ?? '' }))
          : undefined,
      })
      toast({ title: 'Dispute resolved' })
      qc.invalidateQueries({ queryKey: ['submission-detail', id] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
      qc.invalidateQueries({ queryKey: ['disputes'] })
      qc.invalidateQueries({ queryKey: ['manager-disputes'] })
      qc.invalidateQueries({ queryKey: ['agent-dispute-history'] })
      setResolutionMode(false)
      setResNotes('')
    } catch (err) {
      setResError(getErrorMessage(err, "Couldn't resolve the dispute. Try again."))
    } finally {
      setResSubmitting(false)
    }
  }

  const resolution: ResolutionState = {
    isActive:      resolutionMode,
    notes:         resNotes,
    error:         resError,
    isSubmitting:  resSubmitting,
    onEnter:       enterResolutionMode,
    onCancel:      () => { setResolutionMode(false); setResNotes(''); setResError(null) },
    onChangeNotes: setResNotes,
    onSubmit:      submitResolution,
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>

      <SubmissionHeader
        detail={detail}
        backLabel={backLabel}
        resolutionMode={resolutionMode}
        canAcceptReview={canAcceptReview}
        canDispute={canDispute}
        finalizing={finalizing}
        finalizeSuccess={finalizeSuccess}
        showDisputeForm={showDisputeForm}
        onBack={() => navigate(-1)}
        onFinalize={() => finalize()}
        onShowDispute={() => setShowDisputeForm(true)}
        canReopen={canReopenReview}
        onReopen={() => setUnlockTarget('SUBMISSION')}
      />

      {activeUnlock && (
        <UnlockBanner unlock={activeUnlock} submissionId={detail.id} canResume={canResumeDraft} />
      )}

      {lastReopen && <ReopenedNotice reopen={lastReopen} isAgent={isAgent} />}

      {unlockTarget && (
        <UnlockDialog
          open
          entity={unlockTarget}
          entityId={unlockTarget === 'DISPUTE' ? Number(detail.dispute?.id) : detail.id}
          onOpenChange={(o) => !o && setUnlockTarget(null)}
          onSuccess={onUnlockSuccess}
        />
      )}

      {/* Resolution mode banner */}
      {resolutionMode && (
        <div className="shrink-0 bg-amber-50 border border-amber-200 rounded-xl mx-6 px-4 py-2.5 flex items-center gap-3 mb-2">
          <Edit3 className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="flex-1 text-[12px] font-medium text-amber-800">
            <span className="font-bold">Resolution Mode</span> — edit answers in the right panel to adjust the score,
            then submit your decision in the left panel.
          </p>
          <button onClick={resolution.onCancel}
            className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Two-pane split */}
      <div className="px-6 pb-6 flex flex-1 min-h-0 overflow-hidden gap-4">

        {/* Left pane */}
        <div className="w-1/2 shrink-0 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto">
          <div className="p-3 space-y-2.5">
            {showDisputeForm && (
              <DisputeForm submissionId={detail.id} onSuccess={() => setShowDisputeForm(false)} />
            )}
            <ReviewDetailsPanel
              topFields={topReviewFields}
              bottomFields={bottomReviewFields}
              hasBottomFields={hasBottomReviewFields}
              agentName={detail.csr_name}
              isAgent={isAgent}
              username={user?.username}
            />
            {detail.dispute && (
              <DisputePanel
                submissionId={Number(id)}
                dispute={detail.dispute}
                isAgent={isAgent}
                editingDispute={editingDispute}
                onEditDispute={setEditingDispute}
                canResolveDispute={canResolveDispute}
                resolution={resolution}
                formData={formData}
                canReopen={canReopenDispute}
                onReopen={() => setUnlockTarget('DISPUTE')}
              />
            )}
            {/* Phase C (C6): when a multi-source case has both a ticket
                and a call, present them as tabs so the reviewer can
                flip between sources without losing screen real estate.
                Single-source submissions keep the legacy stacked
                layout. */}
            {ticketTasks.length > 0 && (calls?.length ?? 0) > 0 ? (
              <Tabs defaultValue="ticket" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="ticket">
                    Ticket / Task ({ticketTasks.length})
                  </TabsTrigger>
                  <TabsTrigger value="call">Call ({calls?.length ?? 0})</TabsTrigger>
                </TabsList>
                <TabsContent value="ticket" className="mt-2">
                  <TicketTaskDetailsPanel ticketTasks={ticketTasks} auditAt={auditAt} />
                </TabsContent>
                <TabsContent value="call" className="mt-2">
                  <CallDetailsPanel calls={calls ?? []} />
                </TabsContent>
              </Tabs>
            ) : (
              <>
                <TicketTaskDetailsPanel ticketTasks={ticketTasks} auditAt={auditAt} />
                <CallDetailsPanel calls={calls ?? []} />
              </>
            )}
            {/* AI side outputs persisted in submissions.ai_extras. Each
                panel auto-hides when its array is empty so human-authored
                submissions stay visually unchanged. */}
            {detail.ai_extras && (
              <>
                <TimelinePanel items={detail.ai_extras.timeline ?? null} />
                <AdvisoryObservationsPanel
                  items={(detail.ai_extras.observations ?? null) as AdvisoryObservation[] | null}
                />
                <AnswerEvidencePanel items={buildAnswerEvidenceEntries(detail)} />
              </>
            )}
          </div>
        </div>

        {/* Right pane */}
        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto min-w-0">
          <ScorePanel
            score={score}
            disputeAdjusted={disputeAdjusted}
            prevScore={prevScore}
            adjScore={adjScore}
            resolutionMode={resolutionMode}
            liveScore={liveScore}
            editRenderData={editRenderData}
            formData={formData}
            answersMap={answersMap}
            roleId={roleId}
            detail={detail}
            scoreBreakdown={detail.scoreBreakdown}
            onEditAnswer={handleEditAnswer}
          />
        </div>

      </div>
    </div>
  )
}
