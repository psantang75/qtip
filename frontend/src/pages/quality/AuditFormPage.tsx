import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Send, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getFormById } from '@/services/formService'
import submissionService from '@/services/submissionService'
import phoneSystemService from '@/services/phoneSystemService'
import MultipleCallSelector from '@/components/MultipleCallSelector'
import FormMetadataDisplay from '@/components/FormMetadataDisplay'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
} from '@/utils/forms'
import { validateAnswers } from '@/utils/submissionUtils'
import { extractTranscriptText } from '@/utils/transcriptUtils'
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

  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [score, setScore] = useState(0)
  const [hasChanges, setHasChanges] = useState(false)
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({})
  const [callDetails, setCallDetails] = useState<any>(null)
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [categoryScores, setCategoryScores] = useState<Record<number, { raw: number; weighted: number }>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [missingQuestions, setMissingQuestions] = useState<number[]>([])
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({})
  const [isLoadingAudio, setIsLoadingAudio] = useState(false)
  const [selectedCalls, setSelectedCalls] = useState<Call[]>([])

  void isLoadingAudio; void hasChanges; void categoryScores; void callDetails

  const scrollToQuestion = (questionId: number) => {
    const el = document.getElementById(`question-${questionId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-red-50', 'border-red-300')
      setTimeout(() => el.classList.remove('bg-red-50', 'border-red-300'), SCROLL_HIGHLIGHT_DURATION)
    }
  }

  const fetchAudioUrl = async (conversationId: string) => {
    if (!conversationId.trim()) return
    setIsLoadingAudio(true)
    try {
      const result = await phoneSystemService.getAudioAndTranscriptByConversationId(conversationId.trim())
      if (result.audio || result.transcript) {
        const processedTranscript = extractTranscriptText(result.transcript?.transcript)
        setCallDetails((prev: any) => ({ ...prev, audio_url: result.audio?.audio_url || null, transcript: processedTranscript }))
      } else {
        setCallDetails((prev: any) => ({ ...prev, audio_url: null, transcript: 'No transcript available' }))
      }
    } catch {
      setCallDetails((prev: any) => ({ ...prev, audio_url: null, transcript: 'Error loading transcript' }))
    } finally {
      setIsLoadingAudio(false)
    }
  }

  useEffect(() => {
    if (!formId) { navigate('/app/quality/review-forms'); return }
    const init = async () => {
      try {
        setLoading(true)
        const fetchedForm = await getFormById(Number(formId))
        setForm(fetchedForm)
        const emptyAnswers: Record<number, AnswerType> = {}
        const emptyStrings: Record<number, string> = {}
        const initialVisibility = processConditionalLogic(fetchedForm, emptyStrings)
        const { totalScore, categoryScores: initCatScores } = calculateFormScore(fetchedForm, emptyAnswers)
        setAnswers(emptyAnswers)
        setVisibilityMap(initialVisibility)
        setCategoryScores(initCatScores)
        setScore(totalScore)
        setFormRenderData(prepareFormForRender(fetchedForm, emptyAnswers, initialVisibility, initCatScores, totalScore))

        const initialMeta: Record<string, string> = {}
        const today = new Date().toISOString().split('T')[0]
        if (fetchedForm.metadata_fields) {
          fetchedForm.metadata_fields.forEach((field: any) => {
            const key = (field.id && field.id !== 0) ? field.id.toString() : field.field_name
            if (field.field_type === 'AUTO') {
              if ((field.field_name === 'Reviewer Name' || field.field_name === 'Auditor Name') && user)
                initialMeta[key] = user.username
              else if (field.field_name === 'Review Date' || field.field_name === 'Audit Date')
                initialMeta[key] = today
            }
          })
        }
        setMetadataValues(initialMeta)
        if (callId) {
          setCallDetails({ id: Number(callId), call_id: callId, csr_id: csrId || '', call_date: '', duration: 0, transcript: '', audio_url: null })
        }
      } catch (err) {
        console.error('Error loading form:', err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [formId, callId, csrId, navigate, user])

  const updateRenderData = (formData: any, currentAnswers: Record<number, AnswerType>) => {
    if (!formData) return
    const answerStrings: Record<number, string> = {}
    Object.entries(currentAnswers).forEach(([qId, a]) => { answerStrings[Number(qId)] = a.answer || '' })
    const newVisibility = processConditionalLogic(formData, answerStrings)
    const { totalScore, categoryScores: newCatScores } = calculateFormScore(formData, currentAnswers)
    setScore(totalScore)
    setCategoryScores(newCatScores)
    setVisibilityMap(newVisibility)
    setFormRenderData(prepareFormForRender(formData, currentAnswers, newVisibility, newCatScores, totalScore))
  }

  const handleAnswerChange = (questionId: number, value: string, questionType: string) => {
    if (!form) return
    let qScore = 0
    let foundQ: any
    for (const cat of form.categories) {
      const q = cat.questions.find((q: any) => q.id === questionId)
      if (q) { foundQ = q; break }
    }
    if (!foundQ) return
    const qt = questionType.toLowerCase()
    if (qt === 'yes_no') {
      qScore = value.toLowerCase() === 'yes' ? (foundQ.yes_value ?? 0) : value.toLowerCase() === 'no' ? (foundQ.no_value ?? 0) : 0
    } else if (qt === 'scale') {
      qScore = parseInt(value) || 0
    } else if (qt === 'radio' && foundQ.radio_options) {
      const opt = foundQ.radio_options.find((o: any) => o.option_value === value)
      if (opt) qScore = opt.score || 0
    }
    const newAnswers = { ...answers, [questionId]: { question_id: questionId, answer: value, score: qScore, notes: answers[questionId]?.notes || '' } }
    setAnswers(newAnswers)
    setHasChanges(true)
    updateRenderData(form, newAnswers)
  }

  const handleNotesChange = (questionId: number, notes: string) => {
    if (!form) return
    setAnswers(prev => ({ ...prev, [questionId]: { ...prev[questionId], notes } }))
    setHasChanges(true)
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
      .then(() => { setHasChanges(false); navigate('/app/quality/submissions', { state: { message: 'Audit submitted successfully!' } }) })
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
      .then(() => { setHasChanges(false); navigate('/app/quality/submissions', { state: { message: 'Draft saved.' } }) })
      .catch(() => setErrorMessage('Failed to save draft. Please try again.'))
      .finally(() => setSubmitting(false))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-[#00aeef] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">QA Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{form?.form_name}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT: Metadata + Call Details + Score breakdown */}
        <div className="lg:w-1/2 space-y-5">
          {form?.metadata_fields && form.metadata_fields.length > 0 && (
            <div className="rounded-xl overflow-hidden">
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
                  const field = form.metadata_fields.find((f: any) => {
                    const k = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
                    return k === fieldId
                  })
                  if (field && (field.field_name?.toLowerCase().includes('conversation') || field.field_name?.toLowerCase().includes('recording id'))) {
                    if (value.trim()) await fetchAudioUrl(value)
                    else setCallDetails((prev: any) => ({ ...prev, audio_url: null }))
                  }
                }}
                readonly={false}
                currentUser={user ? { id: user.id, username: user.username } : undefined}
              />
            </div>
          )}

          <div className="rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-t-lg border-b-0">
              <h3 className="text-[15px] font-semibold text-slate-800">Call Details</h3>
            </div>
            <div className="border border-t-0 border-slate-200 rounded-b-lg bg-white px-4 py-3">
            <MultipleCallSelector
              selectedCalls={selectedCalls}
              onCallsChange={(calls: Call[]) => { setSelectedCalls(calls); setHasChanges(true) }}
              disabled={submitting}
            />
            </div>
          </div>

        </div>

        {/* RIGHT: QA Form Questions */}
        <div className="lg:w-1/2">
          <div className="rounded-xl overflow-hidden">
            {/* Panel header */}
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-t-lg border-b-0">
              <h3 className="text-[15px] font-semibold text-slate-800">{form?.form_name}</h3>
            </div>

            <div className="border border-t-0 border-slate-200 rounded-b-lg bg-white">
              {formRenderData ? (
                <FormRenderer formRenderData={formRenderData} isDisabled={false} onAnswerChange={handleAnswerChange} onNotesChange={handleNotesChange} />
              ) : (
                <div className="p-4 bg-red-50 border-b border-red-200 text-[13px] text-red-700">No form data available.</div>
              )}

              {errorMessage && (
                <div className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                    <div className="text-[13px] text-red-700">
                      {errorMessage.split('\n').map((line, i) => {
                        if (line.startsWith('- ') && missingQuestions[i - 1]) {
                          return (
                            <p key={i} className="cursor-pointer hover:underline" onClick={() => scrollToQuestion(missingQuestions[i - 1])}>
                              {line} <span className="text-xs">(click to scroll)</span>
                            </p>
                          )
                        }
                        return <p key={i}>{line}</p>
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                <Button variant="outline" onClick={handleSaveDraft} disabled={submitting}>
                  <Save className="h-4 w-4 mr-2" />
                  {submitting ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button onClick={handleSubmit} disabled={submitting} className="bg-[#00aeef] hover:bg-[#0095cc] text-white">
                  <Send className="h-4 w-4 mr-2" />
                  {submitting ? 'Submitting...' : 'Submit Review'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
