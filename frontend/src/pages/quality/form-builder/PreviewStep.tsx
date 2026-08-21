import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Form } from '@/types/form.types'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
  getQuestionScore,
  deriveRollupAnswers,
} from '@/utils/forms'
import FormMetadataDisplay from '@/components/common/FormMetadataDisplay'
import { ScoreBreakdownTables } from '@/components/quality/ScoreBreakdownTables'
import { cn } from '@/lib/utils'
import { totalCategoryWeight, normalizeFormMetadata } from './formBuilderUtils'
import userService from '@/services/userService'

interface PreviewAnswer { question_id: number; answer: string; score: number; notes: string }

interface PreviewStepProps {
  form: Form
  onBack?: () => void
  onSave?: () => void
  saving?: boolean
}

export function PreviewStep({ form, onBack, onSave, saving }: PreviewStepProps) {
  const total    = totalCategoryWeight(form.categories)
  const weightOk = Math.abs(total - 1) < 0.005

  const previewForm = useMemo(() => {
    const f = JSON.parse(JSON.stringify(form)) as Form
    const n = normalizeFormMetadata(f)
    n.categories.forEach((cat, ci) => {
      if (!cat.id) cat.id = -(ci + 1) * 1000
      cat.questions.forEach((q, qi) => {
        if (!q.id) q.id = -((ci + 1) * 1000 + qi + 1)
      })
    })
    return n
  }, [form])

  const { data: agentUsers = [] } = useQuery({
    queryKey: ['agent-dropdown-users-preview'],
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

  const [answers, setAnswers]               = useState<Record<number, PreviewAnswer>>({})
  const [visibilityMap, setVisibilityMap]   = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const strings: Record<number, string> = {}
    const vis = processConditionalLogic(previewForm, strings)
    // Even with an empty answer map we still run the engine so that
    // role=ROLLUP questions render as "Auto-N/A" (or YES) instead of
    // sitting blank in the preview.
    const derived = deriveRollupAnswers(previewForm, {}, vis).answers
    const { totalScore, categoryScores } = calculateFormScore(previewForm, derived)
    setVisibilityMap(vis)
    setFormRenderData(prepareFormForRender(previewForm, derived, vis, categoryScores, totalScore))
  }, [previewForm])

  useEffect(() => {
    if (!Object.keys(answers).length && !formRenderData) return
    const strings: Record<number, string> = {}
    Object.entries(answers).forEach(([id, a]) => { strings[Number(id)] = a.answer || '' })
    const vis = processConditionalLogic(previewForm, strings)
    const derived = deriveRollupAnswers(previewForm, answers, vis).answers
    const { totalScore, categoryScores } = calculateFormScore(previewForm, derived)
    setVisibilityMap(vis)
    setFormRenderData(prepareFormForRender(previewForm, derived, vis, categoryScores, totalScore))
  }, [answers, previewForm]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswerChange = useCallback((questionId: number, value: string) => {
    const question = previewForm.categories.flatMap(c => c.questions).find(q => q.id === questionId)
    const score = question ? getQuestionScore(question, value) : 0
    setAnswers(prev => ({ ...prev, [questionId]: { question_id: questionId, answer: value, score, notes: prev[questionId]?.notes || '' } }))
  }, [previewForm])

  const handleNotesChange = useCallback((questionId: number, notes: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: { ...prev[questionId], notes, question_id: questionId, answer: prev[questionId]?.answer || '', score: prev[questionId]?.score || 0 } }))
  }, [])

  const totalScore   = formRenderData?.totalScore ?? 0
  const scoreClass   = totalScore >= 85 ? 'text-emerald-600' : totalScore >= 70 ? 'text-amber-600' : 'text-red-600'
  const scoreBgClass = totalScore >= 85 ? 'bg-emerald-500' : totalScore >= 70 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex flex-col h-full min-h-0">
      {!weightOk && (
        <div className="shrink-0 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700 text-sm mb-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Category weights sum to {(total * 100).toFixed(0)}% — must be exactly 100% before saving.
        </div>
      )}

      {/* Fixed header — form name + back/save */}
      <div className="shrink-0 bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{form.form_name}</h2>
          <p className="text-xs text-slate-500 mt-0.5">v{form.version ?? 1} · {form.interaction_type} · {form.is_active ? 'Active' : 'Inactive'}</p>
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />Back
            </Button>
          )}
          {onSave && (
            <Button onClick={onSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-white">
              {saving ? 'Saving…' : form.id ? 'Save as New Version' : 'Create Form'}
            </Button>
          )}
        </div>
      </div>

      {/* Dual-pane body — each side scrolls independently */}
      <div className="flex flex-1 min-h-0 gap-4">

        {/* Left pane — metadata + form questions */}
        <div className="w-1/2 shrink-0 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto">
          <div className="p-3 space-y-2.5">
            {previewForm.metadata_fields && previewForm.metadata_fields.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <span className="text-[13px] font-semibold text-slate-800">Form Details</span>
                </div>
                <div className="px-4 py-3">
                  <FormMetadataDisplay
                    metadataFields={previewForm.metadata_fields}
                    values={Object.fromEntries(previewForm.metadata_fields.map(f => {
                      const key = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
                      return [key, metadataValues[key] || '']
                    }))}
                    onChange={(fieldId, value) => setMetadataValues(prev => ({ ...prev, [fieldId]: value }))}
                    readonly={false}
                    currentUser={{ id: 1, username: 'Preview User' }}
                    userOptions={agentUserOptions}
                  />
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <span className="text-[13px] font-semibold text-slate-800">Form Questions</span>
              </div>
              {formRenderData ? (
                <FormRenderer
                  formRenderData={formRenderData}
                  isDisabled={false}
                  onAnswerChange={handleAnswerChange}
                  onNotesChange={handleNotesChange}
                />
              ) : (
                <div className="py-8 text-center text-slate-400 text-sm">Loading preview…</div>
              )}
            </div>
          </div>
        </div>

        {/* Right pane — scores */}
        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto min-w-0">
          <div className="p-3 space-y-2.5">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <span className="text-[13px] font-semibold text-slate-800">Overall Form Score</span>
              </div>
              <div className="px-5 py-4 text-center">
                <div className={cn('text-[44px] font-bold tracking-tight leading-none', scoreClass)}>
                  {totalScore.toFixed(1)}<span className="text-2xl font-semibold ml-0.5 opacity-50">%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 mt-3">
                  <div className={cn('h-2.5 rounded-full transition-all', scoreBgClass)} style={{ width: `${Math.min(100, totalScore)}%` }} />
                </div>
              </div>
            </div>

            {/* Question Scores + Category Scores + How Scoring Works.
                Shared with the AuditFormPage AI-draft Score Breakdown
                modal so reviewers and form authors see identical math. */}
            {formRenderData && (
              <ScoreBreakdownTables
                form={previewForm}
                formRenderData={formRenderData}
                answers={answers}
                visibilityMap={visibilityMap}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
