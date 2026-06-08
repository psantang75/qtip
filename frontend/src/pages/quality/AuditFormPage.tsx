import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save, Send, AlertCircle, Calculator } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getFormById } from '@/services/formService'
import { normalizeFormMetadata } from '@/pages/quality/form-builder/formBuilderUtils'
import submissionService from '@/services/submissionService'
import aiReviewerService from '@/services/aiReviewerService'
import MultipleCallSelector from '@/components/common/MultipleCallSelector'
import { CallDetailsPanel } from './submission-detail/CallDetailsPanel'
import TicketTaskSelector, { type TicketTaskRef } from '@/components/common/TicketTaskSelector'
import type { Call } from '@/services/callService'
import FormMetadataDisplay from '@/components/common/FormMetadataDisplay'
import userService from '@/services/userService'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
  getQuestionScore,
  deriveRollupAnswers,
  type FormRenderData,
} from '@/utils/forms'
import { validateAnswers } from '@/utils/submissionUtils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScoreBreakdownTables } from '@/components/quality/ScoreBreakdownTables'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TimelinePanel } from '@/components/quality/ai/TimelinePanel'
import { AdvisoryObservationsPanel, type AdvisoryObservation } from '@/components/quality/ai/AdvisoryObservationsPanel'

interface AnswerType {
  question_id: number
  answer: string
  score: number
  notes: string
}

const SCROLL_HIGHLIGHT_DURATION = 3000

export default function AuditFormPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const formIdParam = searchParams.get('formId')
  const callId = searchParams.get('callId')
  const agentId = searchParams.get('csrId')
  // ── AI Reviewer modes ────────────────────────────────────────────────
  // ?promoteDraft=<aiSubmissionId>            — load AI's DRAFT, edit, promote to SUBMITTED
  // ?calibrationOverlayFor=<aiSubmissionId>   — load AI's SUBMITTED answers, write a NEW human submission
  const promoteDraftId = searchParams.get('promoteDraft')
  const calibrationOverlayId = searchParams.get('calibrationOverlayFor')
  const aiSubmissionId = promoteDraftId
    ? Number(promoteDraftId)
    : calibrationOverlayId
      ? Number(calibrationOverlayId)
      : null
  const aiMode: 'promote' | 'overlay' | null = promoteDraftId
    ? 'promote'
    : calibrationOverlayId
      ? 'overlay'
      : null

  const qc = useQueryClient()

  // When in an AI mode, the formId comes from the AI submission, not the
  // querystring. We block the form fetch until we resolve it.
  const {
    data: aiPrefill,
    isLoading: aiPrefillLoading,
    isError: aiPrefillError,
    error: aiPrefillErrorObj,
  } = useQuery({
    queryKey: ['ai-reviewer-prefill', aiMode, aiSubmissionId],
    queryFn: async () => {
      if (!aiSubmissionId || !aiMode) return null
      // Promote-draft uses the dedicated AI Reviewer draft endpoint
      // (it filters to AI-Reviewer-owned drafts only). Overlay reuses
      // the standard submission-detail endpoint since the source is
      // SUBMITTED.
      if (aiMode === 'promote') {
        return aiReviewerService.getDraft(aiSubmissionId)
      }
      // Lazy import to avoid pulling qaService into pages that don't need it
      const qaServiceMod = await import('@/services/qaService')
      const detail = await qaServiceMod.default.getSubmissionDetail(aiSubmissionId)
      return {
        submission_id: detail.id,
        form_id: detail.form_id ?? null,
        form_name: detail.form_name,
        submitted_at: null as string | null,
        ai_overall_confidence: null as number | null,
        ai_extras: null as import('@/services/aiReviewerService').AiExtras | null,
        answers: (detail.answers ?? [])
          .filter((a: any) => a.question_id != null)
          .map((a: any) => ({ question_id: Number(a.question_id), answer: String(a.answer ?? ''), notes: '' })),
        metadata: [] as Array<{ field_id: number; value: string }>,
        ticket_tasks: [] as Array<{ kind: 'TICKET' | 'TASK'; external_id: number }>,
        calls: [] as NonNullable<import('@/services/aiReviewerService').AiDraftDetail['calls']>,
      }
    },
    enabled: !!(aiSubmissionId && aiMode),
    staleTime: 60 * 1000,
    retry: false, // 403/404/409 from the draft endpoint are deterministic — don't retry
  })

  // Pull the most useful error detail off an axios error so the
  // AI-mode error state can show "this submission isn't an AI draft"
  // instead of a generic "request failed" or — worse — a blank page.
  const aiPrefillErrorDetail = useMemo(() => {
    if (!aiPrefillError) return null
    const e = aiPrefillErrorObj as any
    const status: number | undefined = e?.response?.status
    const code: string | undefined = e?.response?.data?.code
    const serverMsg: string | undefined =
      typeof e?.response?.data?.error === 'string' ? e.response.data.error : undefined
    if (status === 403) {
      return {
        title: 'This submission is not an AI Reviewer draft',
        body:
          serverMsg ??
          'The AI draft endpoint only exposes drafts owned by the AI Reviewer system user. ' +
            'This submission was created or already promoted by a human reviewer, so it cannot be promoted again here.',
      }
    }
    if (status === 404) {
      return {
        title: `Submission ${aiSubmissionId} not found`,
        body: serverMsg ?? 'It may have been deleted or the link is stale.',
      }
    }
    if (status === 409 || code === 'NOT_A_DRAFT') {
      return {
        title: 'This submission is no longer a draft',
        body:
          serverMsg ??
          'It has already been promoted or submitted. Open the submission detail page to view it.',
      }
    }
    return {
      title: 'Failed to load the AI draft',
      body: serverMsg ?? e?.message ?? 'Unknown error.',
    }
  }, [aiPrefillError, aiPrefillErrorObj, aiSubmissionId])

  const formId = aiMode && aiPrefill?.form_id ? String(aiPrefill.form_id) : formIdParam

  // includeInactive=true: a submission is always tied to a specific
  // form_id, and the form may have been deactivated AFTER the
  // submission was created (e.g. an AI-pilot form whose `is_active`
  // gets flipped off once the pilot ends). Auditors still need to be
  // able to grade and review prior submissions on those forms — the
  // `is_active` flag is a "show in pickers" filter, not a permission
  // gate. Mirrors what SubmissionDetailPage and AIReviewerFormDetail
  // already do for the same reason.
  const { data: formRaw, isLoading: loading, isError: formError, refetch: refetchForm } = useQuery({
    queryKey: ['audit-form', formId],
    queryFn: () => getFormById(Number(formId), true),
    enabled: !!formId,
    staleTime: 60 * 1000,
  })

  const form = useMemo(
    () => (formRaw ? normalizeFormMetadata(formRaw) : null),
    [formRaw],
  )

  const { data: agentUsers = [] } = useQuery({
    queryKey: ['agent-dropdown-users'],
    queryFn:  () => userService.fetchActiveCsrsForDropdown(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const agentUserOptions = useMemo(
    () => agentUsers
      .map(u => ({ id: u.id, username: u.username }))
      .sort((a, b) => a.username.localeCompare(b.username)),
    [agentUsers],
  )

  const [score, setScore] = useState(0)
  // Toggles the Score Breakdown modal — re-uses the same `ScoreRenderer`
  // that powers the Form Builder Preview step and the post-submit
  // SubmissionDetailPage's Score panel, so reviewers see the SAME
  // category breakdown / per-question math the system uses everywhere
  // else. Live-updated via `score` state on every answer edit.
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false)
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({})
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [missingQuestions, setMissingQuestions] = useState<number[]>([])

  // "Why are you correcting the AI?" — captured in AI Reviewer modes
  // (promote OR overlay). Always-visible textbox; passing through as
  // ai_calibration_data.notes makes the reason available to future
  // prompt runs as a "Reviewer's reason" bullet.
  const [correctionReason, setCorrectionReason] = useState<string>('')

  const { mutate: doSubmit, isPending: isSubmitting } = useMutation({
    mutationFn: (payload: any) => {
      if (aiMode === 'promote' && aiSubmissionId) {
        return aiReviewerService.promoteDraft(aiSubmissionId, {
          answers: payload.answers,
          metadata: payload.metadata,
          correction_reason: correctionReason.trim() || null,
        })
      }
      if (aiMode === 'overlay' && aiSubmissionId) {
        return aiReviewerService.recordCalibrationOverlay(aiSubmissionId, {
          answers: payload.answers,
          metadata: payload.metadata,
          correction_reason: correctionReason.trim() || null,
        })
      }
      return submissionService.submitAudit(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-inbox'] })
      if (aiMode) {
        const msg =
          aiMode === 'promote'
            ? 'AI draft promoted and scored.'
            : 'Calibration sample recorded.'
        navigate('/app/quality/ai-inbox', { state: { message: msg } })
      } else {
        navigate('/app/quality/review-forms', { state: { message: 'Audit submitted successfully!' } })
      }
    },
    onError: () => setErrorMessage('Failed to submit. Please try again.'),
  })

  const { mutate: doSaveDraft, isPending: isSavingDraft } = useMutation({
    mutationFn: (payload: any) => submissionService.saveDraft(payload),
    onSuccess: () => navigate('/app/quality/submissions', { state: { message: 'Draft saved.' } }),
    onError: () => setErrorMessage('Failed to save draft. Please try again.'),
  })
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({})
  const [selectedCalls, setSelectedCalls] = useState<Call[]>([])
  const [linkedTicketTasks, setLinkedTicketTasks] = useState<TicketTaskRef[]>([])

  const scrollToQuestion = (questionId: number) => {
    const el = document.getElementById(`question-${questionId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-red-50', 'border-red-300')
      setTimeout(() => el.classList.remove('bg-red-50', 'border-red-300'), SCROLL_HIGHLIGHT_DURATION)
    }
  }


  // Redirect if no formId — AI Reviewer modes resolve the formId via the
  // AI submission so we wait for that fetch to complete before judging.
  useEffect(() => {
    if (formId) return
    if (aiMode && !aiPrefill) return
    navigate('/app/quality/review-forms')
  }, [formId, aiMode, aiPrefill, navigate])

  // Initialize derived state once the form data arrives from useQuery.
  // In AI Reviewer modes (promote / overlay) we hydrate the form with
  // the AI's answers as the starting point so the human can edit
  // minimally and promote/submit.
  useEffect(() => {
    if (!form) return
    const seedAnswers: Record<number, AnswerType> = {}
    if (aiMode && aiPrefill?.answers) {
      for (const a of aiPrefill.answers) {
        const qid = Number(a.question_id)
        let foundQ: any
        for (const cat of form.categories) {
          const q = (cat.questions ?? []).find((q: any) => q.id === qid)
          if (q) { foundQ = q; break }
        }
        const qScore = foundQ ? getQuestionScore(foundQ, a.answer) : 0
        seedAnswers[qid] = { question_id: qid, answer: a.answer, score: qScore, notes: a.notes ?? '' }
      }
    }
    const seedStrings: Record<number, string> = {}
    Object.entries(seedAnswers).forEach(([qId, a]) => { seedStrings[Number(qId)] = a.answer || '' })
    const initialVisibility = processConditionalLogic(form, seedStrings)
    // Derive roll-up answers BEFORE scoring so role=ROLLUP questions
    // contribute their engine-computed value (yes / no / na) and any
    // saved (DB) value the AI may have stored is overwritten with the
    // canonical derived value. Re-score also re-derives them on every
    // subsequent edit via updateRenderData() below, so the audit form
    // stays in sync as the human flips DETAIL answers.
    const seededWithRollups = deriveRollupAnswers(form, seedAnswers, initialVisibility).answers
    const { totalScore, categoryScores: initCatScores } = calculateFormScore(form, seededWithRollups)
    setAnswers(seededWithRollups)
    setVisibilityMap(initialVisibility)
    setScore(totalScore)
    setFormRenderData(prepareFormForRender(form, seededWithRollups, initialVisibility, initCatScores, totalScore))

    const today = new Date().toISOString().split('T')[0]
    const initialMeta: Record<string, string> = {}
    ;(form.metadata_fields ?? []).forEach((field: any) => {
      const key = (field.id && field.id !== 0) ? field.id.toString() : field.field_name
      if (field.field_type === 'AUTO') {
        if ((field.field_name === 'Reviewer Name' || field.field_name === 'Auditor Name') && user)
          initialMeta[key] = user.username
        else if (field.field_name === 'Review Date' || field.field_name === 'Audit Date')
          initialMeta[key] = today
      }
    })

    // In AI Reviewer modes, overlay the AI's saved metadata (Interaction
    // Date, CSR, etc.) on top of the auto defaults so the human reviewer
    // sees what the AI captured. Auto fields stay live (current user /
    // today) — those are the human's stamp, not the AI's.
    if (aiMode && aiPrefill?.metadata) {
      const autoFieldKeys = new Set(
        (form.metadata_fields ?? [])
          .filter((f: any) => f.field_type === 'AUTO')
          .map((f: any) => ((f.id && f.id !== 0) ? f.id.toString() : f.field_name))
      )
      for (const m of aiPrefill.metadata) {
        const key = String(m.field_id)
        if (autoFieldKeys.has(key)) continue
        if (m.value != null && m.value !== '') initialMeta[key] = String(m.value)
      }
    }
    setMetadataValues(initialMeta)

    // Hydrate the linked ticket(s) / task(s) from the AI submission so
    // the left-pane TicketTaskSelector shows what's already attached.
    if (aiMode && aiPrefill?.ticket_tasks?.length) {
      setLinkedTicketTasks(
        aiPrefill.ticket_tasks
          .filter((t: any) => t && (t.kind === 'TICKET' || t.kind === 'TASK') && Number.isFinite(Number(t.external_id)))
          .map((t: any) => ({ kind: t.kind, external_id: Number(t.external_id) }))
      )
    }

    // Hydrate the linked call(s) from the AI submission (Phase C
    // multi-source). Without this, a draft whose primary source was a
    // CALL (or that has an attached CALL) re-opens in the audit page
    // showing only the ticket and silently drops the call — the user
    // sees no transcript / recording context to grade against.
    if (aiMode && aiPrefill?.calls?.length) {
      setSelectedCalls(
        aiPrefill.calls
          .filter((c: any) => c && Number.isFinite(Number(c.id)) && typeof c.call_id === 'string')
          .map((c: any) => ({
            id: Number(c.id),
            call_id: String(c.call_id),
            csr_id: Number(c.csr_id),
            customer_id: c.customer_id ?? null,
            call_date: String(c.call_date),
            duration: Number(c.duration ?? 0),
            recording_url: c.recording_url ?? null,
            transcript: c.transcript ?? null,
          }))
      )
    }
  }, [form, user, aiMode, aiPrefill])

  const updateRenderData = (formData: any, currentAnswers: Record<number, AnswerType>) => {
    if (!formData) return
    const answerStrings: Record<number, string> = {}
    Object.entries(currentAnswers).forEach(([qId, a]) => { answerStrings[Number(qId)] = a.answer || '' })
    const newVisibility = processConditionalLogic(formData, answerStrings)
    // Re-derive roll-ups whenever a detail answer changes so any
    // role=ROLLUP question reflects the new state immediately. We push
    // the derived map back into React state via setAnswers so subsequent
    // edits (and the submit handler downstream) see the canonical value
    // rather than the stale pre-engine map.
    const withRollups = deriveRollupAnswers(formData, currentAnswers, newVisibility).answers
    const { totalScore } = calculateFormScore(formData, withRollups)
    // deriveRollupAnswers returns the shared `Answer` shape (notes/score
    // optional). Local state uses the stricter `AnswerType` shape, so fill
    // in the defaults rather than widen the state type.
    const normalized: Record<number, AnswerType> = {}
    for (const [k, v] of Object.entries(withRollups)) {
      normalized[Number(k)] = {
        question_id: v.question_id,
        answer: v.answer,
        score: v.score ?? 0,
        notes: v.notes ?? '',
      }
    }
    setScore(totalScore)
    setVisibilityMap(newVisibility)
    setAnswers(normalized)
    setFormRenderData(prepareFormForRender(formData, withRollups, newVisibility, {}, totalScore))
  }

  const handleAnswerChange = (questionId: number, value: string, _questionType: string) => {
    if (!form) return
    let foundQ: any
    for (const cat of form.categories) {
      const q = cat.questions.find((q: any) => q.id === questionId)
      if (q) { foundQ = q; break }
    }
    if (!foundQ) return
    const qScore = getQuestionScore(foundQ, value)
    const newAnswers = { ...answers, [questionId]: { question_id: questionId, answer: value, score: qScore, notes: answers[questionId]?.notes || '' } }
    setAnswers(newAnswers)
    updateRenderData(form, newAnswers)
  }

  const handleNotesChange = (questionId: number, notes: string) => {
    if (!form) return
    setAnswers(prev => ({ ...prev, [questionId]: { ...prev[questionId], notes } }))
    
  }

  const handleSubmit = () => {
    if (!form || !formId || !user) return
    setErrorMessage(null); setMissingQuestions([])

    if (form.metadata_fields?.length > 0) {
      const missing: string[] = []
      form.metadata_fields.forEach((field: any) => {
        if (field.is_required) {
          const key = (field.id && field.id !== 0) ? field.id.toString() : field.field_name
          if (!metadataValues[key]?.trim()) missing.push(field.field_name)
        }
      })
      if (missing.length > 0) {
        setErrorMessage(`Please fill in all required form details:\n${missing.map((f: string) => `- ${f}`).join('\n')}`)
        return
      }
    }

    const validation = validateAnswers(form.categories, answers, visibilityMap)
    if (!validation.isValid) {
      const qMap = new Map<number, string>()
      form.categories.forEach((cat: any) => cat.questions?.forEach((q: any) => { if (q.id) qMap.set(q.id, q.question_text) }))
      setErrorMessage(`Please answer all required questions:\n${validation.unansweredQuestions.map((qId: number) => `- ${qMap.get(qId) || `Q${qId}`}`).join('\n')}`)
      setMissingQuestions(validation.unansweredQuestions)
      if (validation.unansweredQuestions.length > 0) setTimeout(() => scrollToQuestion(validation.unansweredQuestions[0]), 100)
      return
    }

    let customerId: string | null = null
    let agentUserId: number | null = null
    if (form.metadata_fields && metadataValues) {
      for (const f of form.metadata_fields as any[]) {
        const key = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
        const val = metadataValues[key]
        if (!val) continue
        if (f.field_name?.toLowerCase().includes('customer')) customerId = val
        if (f.field_type === 'DROPDOWN' && !f.dropdown_source) {
          const parsed = parseInt(val, 10)
          if (!isNaN(parsed) && parsed > 0) agentUserId = parsed
        }
      }
    }

    const payload = {
      form_id: Number(formId),
      call_id: callId ? Number(callId) : null,
      call_ids: selectedCalls.map(c => c.id),
      call_data: selectedCalls.map(c => ({
        call_id: c.call_id, customer_id: customerId || c.customer_id,
        call_date: c.call_date, duration: c.duration, recording_url: c.recording_url, transcript: c.transcript,
      })),
      ticket_tasks: linkedTicketTasks,
      csr_id: agentUserId,
      submitted_by: user.id,
      answers: Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    }

    doSubmit(payload)
  }

  const handleSaveDraft = () => {
    if (!form || !formId || !user) return
    doSaveDraft({
      form_id:  Number(formId),
      call_id:  callId ? Number(callId) : null,
      call_ids: selectedCalls.map(c => c.id),
      ticket_tasks: linkedTicketTasks,
      submitted_by: user.id,
      answers:  Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    })
  }

  if (loading || (aiMode && aiPrefillLoading)) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-slate-100 rounded animate-pulse w-1/3" />
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  if (aiMode && aiPrefillErrorDetail) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary h-auto px-0">
          <ArrowLeft className="h-3 w-3" />
          Back
        </Button>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="text-[14px] font-semibold text-amber-900">{aiPrefillErrorDetail.title}</h3>
              <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">{aiPrefillErrorDetail.body}</p>
              {aiSubmissionId != null && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline"
                    className="border-amber-300 text-amber-900 hover:bg-amber-100"
                    onClick={() => navigate(`/app/quality/submissions/${aiSubmissionId}`)}>
                    Open submission #{aiSubmissionId}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-amber-900 hover:bg-amber-100"
                    onClick={() => navigate('/app/quality/ai-inbox')}>
                    Back to AI Inbox
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    )
  }

  if (formError) {
    return (
      <div className="p-6">
        <TableErrorState message="Failed to load review form." onRetry={refetchForm} />
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pb-5">
        <div className="flex flex-col gap-1 mb-5">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}
            className="self-start flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary h-auto px-0">
            <ArrowLeft className="h-3 w-3" />
            Back to Review Forms
          </Button>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-slate-900">
              {aiMode === 'promote'
                ? 'Promote AI Draft'
                : aiMode === 'overlay'
                  ? 'Calibration Re-audit'
                  : 'Review Form'}
            </h1>
            <div className="flex items-center gap-3 shrink-0 mt-0.5">
              {!aiMode && (
                <Button variant="outline" onClick={handleSaveDraft} disabled={isSavingDraft || isSubmitting}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {isSavingDraft ? 'Saving…' : 'Save Draft'}
                </Button>
              )}
              <Button onClick={handleSubmit} disabled={isSubmitting || isSavingDraft}
                className="bg-primary hover:bg-primary/90 text-white">
                <Send className="h-4 w-4 mr-1.5" />
                {isSubmitting
                  ? (aiMode === 'promote' ? 'Promoting…' : aiMode === 'overlay' ? 'Recording…' : 'Submitting…')
                  : (aiMode === 'promote' ? 'Promote to Submitted' : aiMode === 'overlay' ? 'Save Calibration' : 'Submit Review')}
              </Button>
            </div>
          </div>
        </div>

        {aiMode && (
          <div className="mt-2 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800 flex items-start justify-between gap-3">
            <div>
              <span className="font-semibold">
                {aiMode === 'promote' ? 'Calibrating mode' : 'Trusted-mode sample'}
              </span>{' '}
              {aiMode === 'promote'
                ? 'You are reviewing answers the AI Reviewer drafted. Edit anything that\'s wrong, then promote to make it the system-of-record submission. Your edits will be captured as a calibration data point.'
                : 'You are re-grading a SUBMITTED AI submission. Your answers will be saved as a separate human submission and recorded as a calibration data point. The AI\'s submission stays in place as the system of record.'}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Live score chip — recalculated on every answer edit by
                  the same `calculateFormScore` call that drives the
                  Score Summary card lower in the layout. Click to open
                  the full per-category / per-question breakdown
                  (ScoreRenderer modal). */}
              <button
                type="button"
                onClick={() => setShowScoreBreakdown(true)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-mono tabular-nums text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors cursor-pointer"
                title="Click to see how this score is calculated"
              >
                <Calculator className="h-3 w-3" />
                Score {score.toFixed(1)}%
              </button>
              {aiPrefill?.ai_overall_confidence != null && (
                <span
                  className="inline-flex items-center rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-mono tabular-nums text-amber-800"
                  title="AI overall_confidence on this draft"
                >
                  AI conf {Math.round(Number(aiPrefill.ai_overall_confidence) * 100)}%
                </span>
              )}
            </div>
          </div>
        )}

        {/* Form name card — mirrors submission detail's title card */}
        <div className="bg-white rounded-xl border border-slate-200 pl-4 pr-11 py-3 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-slate-900 truncate">
            {form?.form_name ?? 'QA Review'}
          </span>
          <span className="text-[15px] text-slate-600 shrink-0">
            {form?.interaction_type && (
              <>Type: <span className="font-bold text-slate-900">{form.interaction_type}</span></>
            )}
          </span>
        </div>

        {/* Score Summary card — same shape as CompletedFormRenderer
            so the AI-draft view and the post-submit view feel like
            the same document. AI mode only: regular Review Form
            workflow has never shown a live score and we don't want
            to change that pattern in this change. Click anywhere on
            the card to open the full breakdown modal. */}
        {aiMode && (
          <button
            type="button"
            onClick={() => setShowScoreBreakdown(true)}
            className="w-full mt-2 bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between hover:border-primary/40 hover:bg-primary/[0.02] transition-colors group text-left cursor-pointer"
            title="Click to see how this score is calculated"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-slate-800">Score Summary</h3>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 group-hover:text-primary transition-colors">
                <Calculator className="h-3 w-3" />
                Show breakdown
              </span>
            </div>
            <div className="text-[28px] font-bold text-slate-900 leading-none tabular-nums">
              {score.toFixed(1)}%
            </div>
          </button>
        )}
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {errorMessage && (
        <div className="shrink-0 bg-red-50 border border-red-200 rounded-xl mx-6 px-4 py-2.5 flex items-start gap-3 mb-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-[13px] text-red-700 space-y-0.5">
            {errorMessage.split('\n').map((line, i) => {
              if (line.startsWith('- ') && missingQuestions[i - 1]) {
                return (
                  <p key={i} className="cursor-pointer hover:underline"
                    onClick={() => scrollToQuestion(missingQuestions[i - 1])}>
                    {line} <span className="text-xs opacity-70">(click to scroll)</span>
                  </p>
                )
              }
              return <p key={i}>{line}</p>
            })}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setErrorMessage(null)}
            className="shrink-0 text-red-400 hover:text-red-600 h-auto p-0 leading-none hover:bg-transparent text-lg">×</Button>
        </div>
      )}

      {/* ── Two-pane split ─────────────────────────────────────────────────── */}
      <div className="px-6 pb-6 flex flex-1 min-h-0 overflow-hidden gap-4">

        {/* ════ LEFT PANE — Form details + Call details ═════════════════════ */}
        <div className="w-1/2 shrink-0 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto">
          <div className="p-3 space-y-2.5">

            {/* Form metadata fields */}
            {form?.metadata_fields && form.metadata_fields.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <span className="text-[13px] font-semibold text-slate-800">Review Details</span>
                </div>
                <div className="px-4 py-3">
                  <FormMetadataDisplay
                    metadataFields={form.metadata_fields}
                    values={Object.fromEntries(
                      form.metadata_fields.map((field: any) => {
                        const key = (field.id && field.id !== 0) ? field.id.toString() : field.field_name
                        return [key, metadataValues[key] || '']
                      })
                    )}
                    onChange={async (fieldId: string, value: string) => {
                      setMetadataValues(prev => ({ ...prev, [fieldId]: value }))
                    }}
                    readonly={false}
                    currentUser={user ? { id: user.id, username: user.username } : undefined}
                    userOptions={agentUserOptions}
                  />
                </div>
              </div>
            )}

            {/* Ticket / Task selector — placed above Call Details so reviewers
                can capture CRM context first, then the call(s) that drove it. */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <span className="text-[13px] font-semibold text-slate-800">Ticket / Task Details</span>
              </div>
              <div className="px-4 py-3">
                <TicketTaskSelector
                  selected={linkedTicketTasks}
                  onChange={setLinkedTicketTasks}
                  disabled={isSubmitting || isSavingDraft}
                />
              </div>
            </div>

            {/* Call details.
                In AI Reviewer modes (promote / overlay) the attached call(s)
                are part of the AI's case identity — the reviewer is grading
                what the AI graded, not re-picking sources. We render the
                canonical read-only CallDetailsPanel (same component used on
                /app/quality/submissions/:id) so the transcript / recording /
                metadata are presented identically across the two screens.
                In the plain human audit flow we keep the search-and-attach
                MultipleCallSelector. */}
            {aiMode ? (
              <CallDetailsPanel
                calls={selectedCalls.map((c) => ({
                  call_id: c.call_id,
                  call_date: c.call_date,
                  recording_url: c.recording_url,
                  transcript: c.transcript,
                }))}
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <span className="text-[13px] font-semibold text-slate-800">Call Details</span>
                </div>
                <div className="px-4 py-3">
                  <MultipleCallSelector
                    selectedCalls={selectedCalls}
                    onCallsChange={(calls: Call[]) => { setSelectedCalls(calls) }}
                    disabled={isSubmitting || isSavingDraft}
                  />
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ════ RIGHT PANE — QA form questions ══════════════════════════════ */}
        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto min-w-0">
          <div className="p-3">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              {formRenderData ? (
                <FormRenderer
                  formRenderData={formRenderData}
                  isDisabled={false}
                  onAnswerChange={handleAnswerChange}
                  onNotesChange={handleNotesChange}
                />
              ) : (
                <div className="p-4 text-[13px] text-slate-400 text-center py-8">No form data available.</div>
              )}
            </div>

            {/* AI side outputs — Timeline + Advisory observations.
                Rendered only in AI modes (promote/overlay) and only when
                ai_extras has items. Each panel auto-hides on empty. */}
            {aiMode && aiPrefill?.ai_extras && (
              <div className="mt-3 space-y-3">
                <TimelinePanel items={aiPrefill.ai_extras.timeline ?? null} />
                <AdvisoryObservationsPanel
                  items={(aiPrefill.ai_extras.observations ?? null) as AdvisoryObservation[] | null}
                />
              </div>
            )}

            {/* "Why are you correcting the AI?" — only in AI Reviewer modes.
                Always visible (no toggle), so reviewers know the AI will
                read this as the rationale next time. */}
            {aiMode && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
                <label htmlFor="correction-reason" className="text-[13px] font-semibold text-slate-800">
                  Why are you correcting the AI?
                  <span className="ml-2 text-[11px] font-normal text-slate-500">
                    (optional but recommended — shown to the AI on its next run for this form)
                  </span>
                </label>
                <textarea
                  id="correction-reason"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  rows={3}
                  placeholder='e.g. "Description was too vague — agent did not restate the customer\u2019s actual symptom in their own words."'
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 leading-snug focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Persists to <code>ai_calibration_data.notes</code>. The most recent reason per question is injected into the
                  next AI run as a &ldquo;Reviewer&rsquo;s reason&rdquo; bullet so the AI can internalize the rule, not just the value.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Score breakdown modal — wraps the same `ScoreRenderer` used by
          the form-builder Preview step and the post-submit Submission
          Detail page, so reviewers see the SAME category breakdown +
          per-question math the system uses everywhere else. The
          renderer reads from local `answers` state, so it updates live
          if the modal is reopened after edits. */}
      <Dialog open={showScoreBreakdown} onOpenChange={setShowScoreBreakdown}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-200 sticky top-0 bg-white z-10">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Calculator className="h-4 w-4 text-primary" />
              Score Breakdown
              <span className="ml-2 text-[13px] font-normal text-slate-500">
                Total: <span className="font-mono tabular-nums font-bold text-slate-900">{score.toFixed(1)}%</span>
              </span>
            </DialogTitle>
          </DialogHeader>
          {form && formRenderData ? (
            <div className="p-4">
              <ScoreBreakdownTables
                form={form}
                formRenderData={formRenderData}
                answers={answers}
                visibilityMap={visibilityMap}
                finalScoreOverride={score}
              />
            </div>
          ) : (
            <div className="p-6 text-[13px] text-slate-400 text-center">No form data available.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

