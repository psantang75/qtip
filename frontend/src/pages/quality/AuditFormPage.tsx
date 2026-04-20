import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save, Send, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getFormById } from '@/services/formService'
import { normalizeFormMetadata } from '@/pages/quality/form-builder/formBuilderUtils'
import submissionService from '@/services/submissionService'
import MultipleCallSelector from '@/components/common/MultipleCallSelector'
import type { Call } from '@/services/callService'
import FormMetadataDisplay from '@/components/common/FormMetadataDisplay'
import userService from '@/services/userService'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
  getQuestionScore,
  type FormRenderData,
} from '@/utils/forms'
import { validateAnswers } from '@/utils/submissionUtils'
import { Button } from '@/components/ui/button'
import { TableErrorState } from '@/components/common/TableErrorState'

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

  const formId = searchParams.get('formId')
  const callId = searchParams.get('callId')
  const agentId = searchParams.get('csrId')

  const qc = useQueryClient()

  const { data: formRaw, isLoading: loading, isError: formError, refetch: refetchForm } = useQuery({
    queryKey: ['audit-form', formId],
    queryFn: () => getFormById(Number(formId)),
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
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({})
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [missingQuestions, setMissingQuestions] = useState<number[]>([])

  const { mutate: doSubmit, isPending: isSubmitting } = useMutation({
    mutationFn: (payload: any) => submissionService.submitAudit(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] })
      navigate('/app/quality/review-forms', { state: { message: 'Audit submitted successfully!' } })
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

  const scrollToQuestion = (questionId: number) => {
    const el = document.getElementById(`question-${questionId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-red-50', 'border-red-300')
      setTimeout(() => el.classList.remove('bg-red-50', 'border-red-300'), SCROLL_HIGHLIGHT_DURATION)
    }
  }


  // Redirect if no formId
  useEffect(() => {
    if (!formId) navigate('/app/quality/review-forms')
  }, [formId, navigate])

  // Initialize derived state once the form data arrives from useQuery
  useEffect(() => {
    if (!form) return
    const emptyAnswers: Record<number, AnswerType> = {}
    const emptyStrings: Record<number, string> = {}
    const initialVisibility = processConditionalLogic(form, emptyStrings)
    const { totalScore, categoryScores: initCatScores } = calculateFormScore(form, emptyAnswers)
    setAnswers(emptyAnswers)
    setVisibilityMap(initialVisibility)
    setScore(totalScore)
    setFormRenderData(prepareFormForRender(form, emptyAnswers, initialVisibility, initCatScores, totalScore))

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
    setMetadataValues(initialMeta)
  }, [form, user])

  const updateRenderData = (formData: any, currentAnswers: Record<number, AnswerType>) => {
    if (!formData) return
    const answerStrings: Record<number, string> = {}
    Object.entries(currentAnswers).forEach(([qId, a]) => { answerStrings[Number(qId)] = a.answer || '' })
    const newVisibility = processConditionalLogic(formData, answerStrings)
    const { totalScore } = calculateFormScore(formData, currentAnswers)
    setScore(totalScore)
    setVisibilityMap(newVisibility)
    setFormRenderData(prepareFormForRender(formData, currentAnswers, newVisibility, {}, totalScore))
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
      submitted_by: user.id,
      answers:  Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    })
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-slate-100 rounded animate-pulse w-1/3" />
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
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
            <h1 className="text-2xl font-bold text-slate-900">Review Form</h1>
            <div className="flex items-center gap-3 shrink-0 mt-0.5">
              <Button variant="outline" onClick={handleSaveDraft} disabled={isSavingDraft || isSubmitting}>
                <Save className="h-4 w-4 mr-1.5" />
                {isSavingDraft ? 'Saving…' : 'Save Draft'}
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting || isSavingDraft}
                className="bg-primary hover:bg-primary/90 text-white">
                <Send className="h-4 w-4 mr-1.5" />
                {isSubmitting ? 'Submitting…' : 'Submit Review'}
              </Button>
            </div>
          </div>
        </div>

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

            {/* Call selector */}
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
          </div>
        </div>

      </div>
    </div>
  )
}

