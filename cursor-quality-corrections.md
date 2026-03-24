# CURSOR PROMPT — Quality Section Corrections (Supplement to Parts 1–3)
## What Parts 1–3 Missed + Required Fixes

After reviewing all original QTIP components in depth, Parts 1–3 are **correct and complete** for the pages they cover (QualityOverviewPage, DisputesPage, FormsPage, QualityAnalyticsPage). However, **two critical pieces are entirely missing** and one piece has a scoring accuracy bug. Apply all fixes below BEFORE executing Parts 1–3.

---

## CRITICAL MISS #1 — The Manual Audit Form

**Why it matters:** This is where QA analysts actually fill out QA reviews. It's the primary scoring entry point. Real-time score calculation happens here as each question is answered. Without it, QA analysts have no way to create new audits. The user explicitly said "the scoring logic is some of the biggest, most important detail."

**What it does:**
- QA selects a form + call + CSR → fills in QA form questions → score recalculates in real-time → submit or save as draft
- Two-column layout: Left = call details + metadata fields. Right = form questions with live score.
- Score breaks down per category as answers are entered.
- Submit sends to API; draft saves progress without submitting.

**This page already has working utilities in the project at `@/utils/forms`** (calculateFormScore, FormRenderer, processConditionalLogic) and **already has working services** (submissionService.submitAudit, submissionService.saveDraft, formService.getFormById, phoneSystemService). Preserve ALL of this logic — only update the outer shell UI to use shadcn/ui.

---

### FILE: `frontend/src/pages/quality/AuditFormPage.tsx`

This is a migration of `frontend/src/components/QAManualAuditForm.tsx` with the outer UI updated to shadcn/ui but ALL form logic, scoring utilities, and service calls preserved exactly.

```tsx
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
import { ScoreRenderer } from '@/utils/forms/scoreRenderer'
import { validateAnswers } from '@/utils/submissionUtils'
import { extractTranscriptText } from '@/utils/transcriptUtils'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────
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

  // ── State ──────────────────────────────────────────────────────────────────
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

  // ── Scroll to missing question ─────────────────────────────────────────────
  const scrollToQuestion = (questionId: number) => {
    const el = document.getElementById(`question-${questionId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-red-50', 'border-red-300')
      setTimeout(() => el.classList.remove('bg-red-50', 'border-red-300'), SCROLL_HIGHLIGHT_DURATION)
    }
  }

  // ── Fetch audio from phone system ──────────────────────────────────────────
  const fetchAudioUrl = async (conversationId: string) => {
    if (!conversationId.trim()) return
    setIsLoadingAudio(true)
    try {
      const result = await phoneSystemService.getAudioAndTranscriptByConversationId(conversationId.trim())
      if (result.audio || result.transcript) {
        const processedTranscript = extractTranscriptText(result.transcript?.transcript)
        setCallDetails((prev: any) => ({
          ...prev,
          audio_url: result.audio?.audio_url || null,
          transcript: processedTranscript,
        }))
      } else {
        setCallDetails((prev: any) => ({ ...prev, audio_url: null, transcript: 'No transcript available' }))
      }
    } catch {
      setCallDetails((prev: any) => ({ ...prev, audio_url: null, transcript: 'Error loading transcript' }))
    } finally {
      setIsLoadingAudio(false)
    }
  }

  // ── Initialize form ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!formId) { navigate('/app/quality/assigned-audits'); return }

    const init = async () => {
      try {
        setLoading(true)
        const fetchedForm = await getFormById(Number(formId))
        setForm(fetchedForm)

        const emptyAnswers: Record<number, AnswerType> = {}
        const emptyStrings: Record<number, string> = {}
        const initialVisibility = processConditionalLogic(fetchedForm, emptyStrings)
        const { totalScore, categoryScores } = calculateFormScore(fetchedForm, emptyAnswers)

        setAnswers(emptyAnswers)
        setVisibilityMap(initialVisibility)
        setCategoryScores(categoryScores)
        setScore(totalScore)
        setFormRenderData(prepareFormForRender(fetchedForm, emptyAnswers, initialVisibility, categoryScores, totalScore))

        // Auto-populate metadata
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

  // ── Update render data when answers change ─────────────────────────────────
  const updateRenderData = (formData: any, currentAnswers: Record<number, AnswerType>) => {
    if (!formData) return
    const answerStrings: Record<number, string> = {}
    Object.entries(currentAnswers).forEach(([qId, a]) => { answerStrings[Number(qId)] = a.answer || '' })
    const newVisibility = processConditionalLogic(formData, answerStrings)
    const { totalScore, categoryScores } = calculateFormScore(formData, currentAnswers)
    setScore(totalScore)
    setCategoryScores(categoryScores)
    setVisibilityMap(newVisibility)
    setFormRenderData(prepareFormForRender(formData, currentAnswers, newVisibility, categoryScores, totalScore))
  }

  // ── Answer change handler ──────────────────────────────────────────────────
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

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!form || !formId || !user) return
    setSubmitting(true)
    setErrorMessage(null)
    setMissingQuestions([])

    // Validate metadata
    if (form.metadata_fields?.length > 0) {
      const missing: string[] = []
      form.metadata_fields.forEach((field: any) => {
        if (field.is_required) {
          const key = (field.id && field.id !== 0) ? field.id.toString() : field.field_name
          if (!metadataValues[key]?.trim()) missing.push(field.field_name)
        }
      })
      if (missing.length > 0) {
        setErrorMessage(`Please fill in all required form details:\n${missing.map(f => `- ${f}`).join('\n')}`)
        setSubmitting(false)
        return
      }
    }

    // Validate answers
    const validation = validateAnswers(form.categories, answers, visibilityMap)
    if (!validation.isValid) {
      const qMap = new Map<number, string>()
      form.categories.forEach((cat: any) => cat.questions?.forEach((q: any) => { if (q.id) qMap.set(q.id, q.question_text) }))
      setErrorMessage(`Please answer all required questions:\n${validation.unansweredQuestions.map(qId => `- ${qMap.get(qId) || `Q${qId}`}`).join('\n')}`)
      setMissingQuestions(validation.unansweredQuestions)
      if (validation.unansweredQuestions.length > 0) setTimeout(() => scrollToQuestion(validation.unansweredQuestions[0]), 100)
      setSubmitting(false)
      return
    }

    // Find customer ID from metadata
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
        call_id: c.call_id, csr_id: c.csr_id,
        customer_id: customerId || c.customer_id,
        call_date: c.call_date, duration: c.duration,
        recording_url: c.recording_url, transcript: c.transcript,
      })),
      submitted_by: user.id,
      answers: Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    }

    submissionService.submitAudit(payload)
      .then(() => {
        setHasChanges(false)
        navigate('/app/quality/submissions', { state: { message: 'Audit submitted successfully!' } })
      })
      .catch(() => setErrorMessage('Failed to submit. Please try again.'))
      .finally(() => setSubmitting(false))
  }

  // ── Save draft ─────────────────────────────────────────────────────────────
  const handleSaveDraft = () => {
    if (!form || !formId || !user) return
    setSubmitting(true)

    const payload = {
      form_id: Number(formId),
      call_id: callId ? Number(callId) : null,
      call_ids: selectedCalls.map(c => c.id),
      submitted_by: user.id,
      answers: Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
    }

    submissionService.saveDraft(payload)
      .then(() => {
        setHasChanges(false)
        navigate('/app/quality/submissions', { state: { message: 'Draft saved.' } })
      })
      .catch(() => setErrorMessage('Failed to save draft. Please try again.'))
      .finally(() => setSubmitting(false))
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-[#00aeef] border-t-transparent" />
      </div>
    )
  }

  // ── Score color ────────────────────────────────────────────────────────────
  const scoreColorClass = score >= 85 ? 'text-emerald-600' : score >= 70 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">QA Review</h1>
            <p className="text-sm text-slate-500 mt-0.5">{form?.form_name}</p>
          </div>
        </div>
        {/* Live score badge */}
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className={cn('text-3xl font-bold', scoreColorClass)}>{score.toFixed(1)}%</div>
            <div className="text-xs text-slate-400">Current Score</div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── LEFT: Metadata + Call Details ── */}
        <div className="lg:w-1/2 space-y-5">
          {/* Metadata fields */}
          {form?.metadata_fields && form.metadata_fields.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">Form Details</h2>
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
                  // Auto-fetch audio when conversation ID field changes
                  const field = form.metadata_fields.find((f: any) => {
                    const k = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
                    return k === fieldId
                  })
                  if (field && (
                    field.field_name?.toLowerCase().includes('conversation') ||
                    field.field_name?.toLowerCase().includes('recording id')
                  )) {
                    if (value.trim()) await fetchAudioUrl(value)
                    else setCallDetails((prev: any) => ({ ...prev, audio_url: null }))
                  }
                }}
                readonly={false}
                currentUser={user ? { id: user.id, username: user.username } : undefined}
              />
            </div>
          )}

          {/* Call selector */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Call Details</h2>
            <MultipleCallSelector
              selectedCalls={selectedCalls}
              onCallsChange={(calls: Call[]) => { setSelectedCalls(calls); setHasChanges(true) }}
              disabled={submitting}
            />
          </div>

          {/* Score breakdown (updates live) */}
          {form && Object.keys(answers).length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">Score Breakdown</h2>
              <ScoreRenderer
                formData={form}
                answers={answers}
                showCategoryBreakdown={true}
                showDetailedScores={true}
                userRole={user?.role_id}
              />
            </div>
          )}
        </div>

        {/* ── RIGHT: QA Form Questions ── */}
        <div className="lg:w-1/2">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">{form?.form_name}</h2>

            {formRenderData ? (
              <FormRenderer
                formRenderData={formRenderData}
                isDisabled={false}
                onAnswerChange={handleAnswerChange}
                onNotesChange={handleNotesChange}
              />
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                No form data available.
              </div>
            )}

            {/* Error display */}
            {errorMessage && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-red-700">
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

            {/* Action buttons */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-200">
              <Button
                variant="outline"
                onClick={handleSaveDraft}
                disabled={submitting}
              >
                <Save className="h-4 w-4 mr-2" />
                {submitting ? 'Saving...' : 'Save Draft'}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-[#00aeef] hover:bg-[#0095cc] text-white"
              >
                <Send className="h-4 w-4 mr-2" />
                {submitting ? 'Submitting...' : 'Submit Review'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## CRITICAL MISS #2 — QA Assigned Audits Page

QA analysts (role 2) need a page showing audits assigned to them with a "Start Audit" button per row. Clicking "Start Audit" navigates to `AuditFormPage`.

### FILE: `frontend/src/pages/quality/AssignedAuditsPage.tsx`

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, ChevronLeft, ChevronRight, RefreshCw, Play, Search } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import submissionService from '@/services/submissionService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function AssignedAuditsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 20

  // Access guard — only QA (role 2) and Admin (role 1)
  if (user && user.role_id !== 1 && user.role_id !== 2) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">
          This page is only accessible to QA analysts.
        </div>
      </div>
    )
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['assigned-audits', page, search],
    queryFn: () => submissionService.getAssignedAudits(page, PAGE_SIZE),
    placeholderData: (prev: any) => prev,
  })

  const totalPages = data?.pagination?.totalPages ?? 1

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Assigned Audits</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data?.pagination?.total ? `${data.pagination.total} assigned` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by CSR name, call ID..."
          className="pl-9 h-9 text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 bg-red-50 flex items-center justify-between">
            <p className="text-red-700 text-sm font-medium">Failed to load assigned audits.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Call ID</TableHead>
                <TableHead>CSR</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Call Date</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data?.length ? (
                data.data
                  .filter((row: any) =>
                    !search ||
                    row.csr_name?.toLowerCase().includes(search.toLowerCase()) ||
                    row.call_external_id?.toLowerCase().includes(search.toLowerCase()) ||
                    row.form_name?.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((row: any) => (
                    <TableRow key={row.assignment_id} className="hover:bg-slate-50">
                      <TableCell className="font-medium text-sm font-mono">{row.call_external_id}</TableCell>
                      <TableCell className="text-sm">{row.csr_name}</TableCell>
                      <TableCell className="text-sm">{row.department_name || '—'}</TableCell>
                      <TableCell className="text-sm">{row.form_name}</TableCell>
                      <TableCell className="text-sm">{new Date(row.call_date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-sm">{formatDuration(row.call_duration)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-7"
                          onClick={() => navigate(`/app/quality/audit?callId=${row.call_id}&formId=${row.form_id}&csrId=${row.csr_id}`)}
                        >
                          <Play className="h-3.5 w-3.5 mr-1" /> Start Audit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400">
                    <ClipboardList className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No assigned audits found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## BUG FIX #3 — SubmissionsPage Score Breakdown

The `CategoryScoreBreakdown` component in Part 1's `SubmissionsPage.tsx` has a critical flaw: it uses a simplified calculation based only on `a.score` from the answer array. The real system uses `ScoreRenderer` from `@/utils/forms/scoreRenderer`, which requires the **form structure** (with weights and question definitions) to calculate scores accurately.

### Fix: Update the detail sheet query in `SubmissionsPage.tsx`

In the `SubmissionsDetailSheet` component (within `SubmissionsPage.tsx`), replace the `CategoryScoreBreakdown` render with `ScoreRenderer`.

**Replace the entire `SubmissionDetailSheet` component's query and detail render section:**

The query must also fetch the form structure:
```tsx
// Replace the detail query inside SubmissionDetailSheet with this version:
const { data: detail, isLoading, isError } = useQuery({
  queryKey: ['submission-detail', submissionId, roleId],
  queryFn: async () => {
    if (!submissionId) return null
    // Fetch submission (with scores)
    let submission: SubmissionDetail
    if (roleId === 3)     submission = await qaService.getCSRAuditDetail(submissionId)
    else if (roleId === 5) submission = await qaService.getTeamAuditDetail(submissionId)
    else                   submission = await qaService.getSubmissionDetail(submissionId)

    // Also fetch full form structure for ScoreRenderer
    if (submission?.form_id) {
      try {
        const { api } = await import('@/services/authService')
        const formRes = await api.get(`/forms/${submission.form_id}?include_inactive=true`)
        ;(submission as any).formData = formRes.data
      } catch { /* use answers-only display if form fetch fails */ }
    }
    return submission
  },
  enabled: !!submissionId && open,
})
```

**Replace `<CategoryScoreBreakdown detail={detail} />` with:**
```tsx
{/* Score breakdown — use ScoreRenderer when form data is available, fallback to simple display */}
{(detail as any).formData ? (
  (() => {
    // Convert answers array to Record<number, {answer, score}> for ScoreRenderer
    const answersMap: Record<number, any> = {}
    detail.answers.forEach((a: any) => {
      if (a.question_id) {
        answersMap[a.question_id] = { answer: a.answer, score: a.score, notes: a.notes || '' }
      }
    })
    return (
      <ScoreRenderer
        formData={(detail as any).formData}
        answers={answersMap}
        backendScore={detail.score}
        scoreBreakdown={(detail as any).scoreBreakdown}
        userRole={roleId}
        showCategoryBreakdown={true}
        showDetailedScores={true}
      />
    )
  })()
) : (
  // Fallback: simple answer list if form data unavailable
  <div className="space-y-2">
    {detail.answers.map((a, i) => (
      <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
        <span className="text-slate-700">{a.question_text}</span>
        <span className={cn('font-medium', a.answer?.toUpperCase() === 'YES' ? 'text-emerald-600' : a.answer?.toUpperCase() === 'NO' ? 'text-red-600' : 'text-slate-700')}>
          {a.answer ?? '—'}
        </span>
      </div>
    ))}
    <div className={cn('flex items-center justify-between rounded-xl p-4 border font-semibold mt-4', scoreBg(detail.score))}>
      <span>Overall Score</span>
      <span className="text-2xl">{detail.score.toFixed(1)}%</span>
    </div>
  </div>
)}
```

**Also add the ScoreRenderer import** at the top of `SubmissionsPage.tsx`:
```tsx
import { ScoreRenderer } from '@/utils/forms/scoreRenderer'
```

---

## STEP: Update Router + NavConfig + Add Missing Imports

### Add to `frontend/src/router/index.tsx` (inside the quality children array):
```tsx
{ path: 'assigned-audits', element: <AssignedAuditsPage /> },
{ path: 'audit',           element: <AuditFormPage /> },
```

Import at top:
```tsx
import AssignedAuditsPage from '@/pages/quality/AssignedAuditsPage'
import AuditFormPage       from '@/pages/quality/AuditFormPage'
```

### Update `frontend/src/config/navConfig.ts` — Quality section items:
```ts
items: [
  { label: 'Overview',          path: '/app/quality/overview',         icon: 'LayoutDashboard', roles: [1,2,3,4,5] },
  { label: 'Assigned Audits',   path: '/app/quality/assigned-audits',  icon: 'ClipboardCheck',  roles: [1,2] },
  { label: 'Form Builder',      path: '/app/quality/forms',            icon: 'ClipboardList',   roles: [1,2] },
  { label: 'Submissions',       path: '/app/quality/submissions',      icon: 'FileCheck',       roles: [1,2,3,5] },
  { label: 'Disputes',          path: '/app/quality/disputes',         icon: 'AlertTriangle',   roles: [1,2,3,5] },
  { label: 'QA Analytics',      path: '/app/quality/analytics',        icon: 'BarChart3',       roles: [1,2,5] },
  // NO scoring route — scoring is in AuditFormPage and SubmissionsPage
],
```

---

## ORDER OF EXECUTION

Apply in this order to avoid import errors:

1. **This file** (corrections) — create `AuditFormPage.tsx` and `AssignedAuditsPage.tsx`
2. **Part 1** — creates `QualityOverviewPage.tsx` and `SubmissionsPage.tsx` (then apply the BUG FIX #3 edits to SubmissionsPage)
3. **Part 2** — creates `FormsPage.tsx` and `DisputesPage.tsx`
4. **Part 3** — creates `QualityAnalyticsPage.tsx`, deletes `ScoringPage.tsx`, updates router and navConfig (use the navConfig from this file, not Part 3)
5. Run `npm run build` — fix any TypeScript errors before moving on

---

## SUMMARY OF WHAT'S IN EACH FILE

| File | Status |
|------|--------|
| `QualityOverviewPage.tsx` | Part 1 — correct |
| `SubmissionsPage.tsx` | Part 1 + Bug Fix #3 from this file |
| `FormsPage.tsx` | Part 2 — correct |
| `DisputesPage.tsx` | Part 2 — correct |
| `QualityAnalyticsPage.tsx` | Part 3 — correct |
| `AuditFormPage.tsx` | **This file** — was entirely missing |
| `AssignedAuditsPage.tsx` | **This file** — was entirely missing |
| `ScoringPage.tsx` | **Delete** (Part 3 instruction) |
| `navConfig.ts` | **This file** overrides Part 3's version |
| Router | Part 3 + additions from this file |
