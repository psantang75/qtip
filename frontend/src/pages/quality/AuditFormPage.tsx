import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save, Send, AlertCircle, ClipboardList } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getFormById } from '@/services/formService'
import submissionService from '@/services/submissionService'
import MultipleCallSelector from '@/components/MultipleCallSelector'
import FormMetadataDisplay from '@/components/FormMetadataDisplay'
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

interface AnswerType {
  question_id: number
  answer: string
  score: number
  notes: string
}

interface Call {
  id: number
  call_id: string
  csr_id: number
  customer_id: string | null
  call_date: string
  duration: number
  recording_url: string | null
  transcript: string | null
  csr_name?: string
  customer_name?: string
}

const SCROLL_HIGHLIGHT_DURATION = 3000

export default function AuditFormPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const formId = searchParams.get('formId')
  const callId = searchParams.get('callId')
  const csrId  = searchParams.get('csrId')

  const qc = useQueryClient()

  const { data: form, isLoading: loading } = useQuery({
    queryKey: ['audit-form', formId],
    queryFn: () => getFormById(Number(formId)),
    enabled: !!formId,
    staleTime: 60 * 1000,
  })

  const [submitting, setSubmitting] = useState(false)
  const [score, setScore] = useState(0)
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({})
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [missingQuestions, setMissingQuestions] = useState<number[]>([])
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
    setSubmitting(true); setErrorMessage(null); setMissingQuestions([])

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
        setSubmitting(false); return
      }
    }

    const validation = validateAnswers(form.categories, answers, visibilityMap)
    if (!validation.isValid) {
      const qMap = new Map<number, string>()
      form.categories.forEach((cat: any) => cat.questions?.forEach((q: any) => { if (q.id) qMap.set(q.id, q.question_text) }))
      setErrorMessage(`Please answer all required questions:\n${validation.unansweredQuestions.map((qId: number) => `- ${qMap.get(qId) || `Q${qId}`}`).join('\n')}`)
      setMissingQuestions(validation.unansweredQuestions)
      if (validation.unansweredQuestions.length > 0) setTimeout(() => scrollToQuestion(validation.unansweredQuestions[0]), 100)
      setSubmitting(false); return
    }

    let customerId: string | null = null
    if (form.metadata_fields && metadataValues) {
      const cidField = form.metadata_fields.find((f: any) => f.field_name?.toLowerCase().includes('customer'))
      if (cidField) {
        const key = (cidField.id && cidField.id !== 0) ? cidField.id.toString() : cidField.field_name
        customerId = metadataValues[key] || null
      }
    }

    const payload = {
      form_id: Number(formId),
      call_id: callId ? Number(callId) : null,
      call_ids: selectedCalls.map(c => c.id),
      call_data: selectedCalls.map(c => ({
        call_id: c.call_id, csr_id: c.csr_id, customer_id: customerId || c.customer_id,
        call_date: c.call_date, duration: c.duration, recording_url: c.recording_url, transcript: c.transcript,
      })),
      submitted_by: user.id,
      answers: Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    }

    submissionService.submitAudit(payload)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['submissions'] })
        navigate('/app/quality/review-forms', { state: { message: 'Audit submitted successfully!' } })
      })
      .catch(() => setErrorMessage('Failed to submit. Please try again.'))
      .finally(() => setSubmitting(false))
  }

  const handleSaveDraft = () => {
    if (!form || !formId || !user) return
    setSubmitting(true)
    const payload = {
      form_id: Number(formId), call_id: callId ? Number(callId) : null,
      call_ids: selectedCalls.map(c => c.id), submitted_by: user.id,
      answers: Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    }
    submissionService.saveDraft(payload)
      .then(() => { navigate('/app/quality/submissions', { state: { message: 'Draft saved.' } }) })
      .catch(() => setErrorMessage('Failed to save draft. Please try again.'))
      .finally(() => setSubmitting(false))
  }

  if (loading) {
    return (
      <div className="-m-6 h-full flex items-center justify-center bg-slate-50">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    // Same two-pane split-screen pattern as SubmissionDetailPage
    <div className="-m-6 h-full flex flex-col overflow-hidden">

      {/* ── Fixed header bar ───────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-5 py-3 z-10">
        <div className="flex items-start gap-4">

          {/* Back to Review Forms */}
          <button onClick={() => navigate(-1)}
            className="shrink-0 flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-primary transition-colors mt-1.5 whitespace-nowrap">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Review Forms
          </button>

          <div className="w-px self-stretch bg-slate-200 shrink-0" />

          {/* Form name */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-slate-900 leading-tight truncate">
              {form?.form_name ?? 'QA Review'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[12px] text-slate-500">
                {form?.interaction_type ?? 'Review Form'} · Reviewer: {user?.username}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 shrink-0 mt-0.5">
            <Button variant="outline" onClick={handleSaveDraft} disabled={submitting}>
              <Save className="h-4 w-4 mr-1.5" />
              {submitting ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}
              className="bg-primary hover:bg-primary/90 text-white">
              <Send className="h-4 w-4 mr-1.5" />
              {submitting ? 'Submitting…' : 'Submit Review'}
            </Button>
          </div>

        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {errorMessage && (
        <div className="shrink-0 bg-red-50 border-b border-red-200 px-5 py-3 flex items-start gap-3">
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
          <button onClick={() => setErrorMessage(null)}
            className="shrink-0 text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Two-pane split ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════ LEFT PANE — Form details + Call details ═════════════════════ */}
        <div className="w-1/2 shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
          <div className="p-4 space-y-4">

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
                  onCallsChange={(calls: Call[]) => { setSelectedCalls(calls);  }}
                  disabled={submitting}
                />
              </div>
            </div>

          </div>
        </div>

        {/* ════ RIGHT PANE — QA form questions ══════════════════════════════ */}
        <div className="w-1/2 bg-white overflow-y-auto">
          <div className="p-4">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="w-[3px] h-4 rounded-full bg-primary shrink-0" />
                  <span className="text-[13px] font-semibold text-slate-800">{form?.form_name}</span>
                </div>
              </div>
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

