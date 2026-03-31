import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import type { Form } from '@/types/form.types'
import { scoreColor } from '@/services/qaService'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
  getQuestionScore,
} from '@/utils/forms'
import type { CategoryRenderData } from '@/utils/forms'
import { getMaxPossibleScore } from '@/utils/forms/scoringAdapter'
import FormMetadataDisplay from '@/components/common/FormMetadataDisplay'
import { cn } from '@/lib/utils'
import { totalCategoryWeight } from './formBuilderUtils'

interface PreviewAnswer { question_id: number; answer: string; score: number; notes: string }

export function PreviewStep({ form }: { form: Form }) {
  const total    = totalCategoryWeight(form.categories)
  const weightOk = Math.abs(total - 1) < 0.005

  const previewForm = useMemo(() => {
    const f = JSON.parse(JSON.stringify(form)) as Form
    f.categories.forEach((cat, ci) => {
      if (!cat.id) cat.id = -(ci + 1) * 1000
      cat.questions.forEach((q, qi) => {
        if (!q.id) q.id = -((ci + 1) * 1000 + qi + 1)
      })
    })
    return f
  }, [form])

  const [answers, setAnswers]               = useState<Record<number, PreviewAnswer>>({})
  const [visibilityMap, setVisibilityMap]   = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const strings: Record<number, string> = {}
    const vis = processConditionalLogic(previewForm, strings)
    const { totalScore, categoryScores } = calculateFormScore(previewForm, {})
    setVisibilityMap(vis)
    setFormRenderData(prepareFormForRender(previewForm, {}, vis, categoryScores, totalScore))
  }, [previewForm])

  useEffect(() => {
    if (!Object.keys(answers).length && !formRenderData) return
    const strings: Record<number, string> = {}
    Object.entries(answers).forEach(([id, a]) => { strings[Number(id)] = a.answer || '' })
    const vis = processConditionalLogic(previewForm, strings)
    const { totalScore, categoryScores } = calculateFormScore(previewForm, answers)
    setVisibilityMap(vis)
    setFormRenderData(prepareFormForRender(previewForm, answers, vis, categoryScores, totalScore))
  }, [answers, previewForm]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswerChange = useCallback((questionId: number, value: string, _type: string) => {
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
    <div className="space-y-4">
      {!weightOk && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Category weights sum to {(total * 100).toFixed(0)}% — must be exactly 100% before saving.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{form.form_name}</h2>
          <p className="text-xs text-slate-500 mt-0.5">v{form.version ?? 1} · {form.interaction_type} · {form.is_active ? 'Active' : 'Inactive'}</p>
        </div>
        <div className="text-center">
          <div className={cn('text-3xl font-bold', scoreClass)}>{totalScore.toFixed(1)}%</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Live Score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-5">
          {form.metadata_fields && form.metadata_fields.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Form Details</h3>
              <FormMetadataDisplay
                metadataFields={form.metadata_fields}
                values={Object.fromEntries(form.metadata_fields.map(f => {
                  const key = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
                  return [key, metadataValues[key] || '']
                }))}
                onChange={(fieldId, value) => setMetadataValues(prev => ({ ...prev, [fieldId]: value }))}
                readonly={false}
                currentUser={{ id: 1, username: 'Preview User' }}
              />
            </div>
          )}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Form Questions</h3>
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

        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Overall Form Score</h3>
            <div className={cn('text-4xl font-bold text-center py-3', scoreClass)}>{totalScore.toFixed(2)}%</div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 mt-2">
              <div className={cn('h-2.5 rounded-full transition-all', scoreBgClass)} style={{ width: `${Math.min(100, totalScore)}%` }} />
            </div>
          </div>

          {formRenderData?.categories && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Question Scores</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Question</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Answer</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Score</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Possible</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Score</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Possible</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(formRenderData.categories as CategoryRenderData[]).map((cat, ci) => {
                      const scoringQs = (cat.allQuestions || []).filter((q: any) => {
                        const t = (q.type || q.question_type || '').toLowerCase()
                        return !['text', 'sub_category', 'info_block'].includes(t)
                      })
                      if (!scoringQs.length) return null
                      return (
                        <React.Fragment key={`cat-${ci}`}>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={7} className="px-3 py-2 font-semibold text-slate-700">
                              <div className="flex justify-between">
                                <span>{cat.name}</span>
                                <span className="font-normal text-slate-500">Weight: {(cat.weight * 100).toFixed(0)}%</span>
                              </div>
                            </td>
                          </tr>
                          {scoringQs.map((q: any, qi: number) => {
                            const ans    = answers[q.id]
                            const vis    = visibilityMap[q.id] !== false
                            const qScore = Number(ans?.score) || 0
                            let maxScore = 0
                            if (vis) {
                              const orig = previewForm.categories.flatMap(c => c.questions).find(x => x.id === q.id)
                              if (orig) {
                                const isNA = ans?.answer?.toLowerCase() === 'na' || ans?.answer?.toLowerCase() === 'n/a'
                                maxScore = (isNA && orig.is_na_allowed) ? 0 : getMaxPossibleScore(orig)
                              }
                            }
                            const catW = Number(cat.weight) || 0
                            return (
                              <tr key={`q-${ci}-${qi}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                                <td className="px-3 py-2 text-slate-600 pl-6 max-w-[200px] truncate" title={q.text}>{q.text}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{vis && ans?.answer ? ans.answer : '—'}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{vis ? qScore : 0}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{maxScore}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{vis ? (qScore * catW).toFixed(2) : '0.00'}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{(maxScore * catW).toFixed(2)}</td>
                                <td className="px-2 py-2 text-center">
                                  <span className={vis ? 'text-emerald-600 font-medium' : 'text-red-500'}>{vis ? 'Yes' : 'No'}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {formRenderData?.categories && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Category Scores</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Category</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Earned</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Possible</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Cat%</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Weight</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Score</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Possible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let totalWtdNum = 0; let totalWtdDen = 0
                      const rows = (formRenderData.categories as CategoryRenderData[]).map((cat, ci) => {
                        const cs = formRenderData.categoryScores?.[cat.id]
                        const earned   = Number(cs?.earnedPoints)   || 0
                        const possible = Number(cs?.possiblePoints) || 0
                        const catPct   = possible > 0 ? (earned / possible) * 100 : 0
                        const w        = Number(cat.weight) || 0
                        const wNum     = earned * w; const wDen = possible * w
                        if (possible > 0) { totalWtdNum += wNum; totalWtdDen += wDen }
                        return (
                          <tr key={ci} className="border-b border-slate-100">
                            <td className="px-3 py-2 text-slate-700 font-medium">{cat.name}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{earned}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{possible}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{catPct.toFixed(0)}%</td>
                            <td className="px-2 py-2 text-center text-slate-600">{(w * 100).toFixed(0)}%</td>
                            <td className="px-2 py-2 text-center text-slate-600">{wNum.toFixed(2)}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{wDen.toFixed(2)}</td>
                          </tr>
                        )
                      })
                      const finalScore = totalWtdDen > 0 ? (totalWtdNum / totalWtdDen) * 100 : 0
                      return [
                        ...rows,
                        <tr key="totals" className="bg-slate-50 border-t-2 border-slate-300 font-semibold">
                          <td className="px-3 py-2 text-slate-800">TOTALS</td>
                          <td colSpan={4} />
                          <td className="px-2 py-2 text-center text-slate-800">{totalWtdNum.toFixed(2)}</td>
                          <td className="px-2 py-2 text-center text-slate-800">{totalWtdDen.toFixed(2)}</td>
                        </tr>,
                        <tr key="final" className="bg-primary/10">
                          <td colSpan={6} className="px-3 py-2 text-right text-slate-700 font-semibold text-sm">Final Score</td>
                          <td className={cn('px-2 py-2 text-center font-bold text-sm', scoreColor(finalScore))}>{finalScore.toFixed(2)}%</td>
                        </tr>,
                      ]
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">How Scoring Works</h3>
            <ul className="text-xs text-slate-600 space-y-1.5">
              <li>• <strong>N/A answers</strong> and hidden conditional questions are excluded from scoring.</li>
              <li>• <strong>Weighted Score</strong> = question score × category weight.</li>
              <li>• <strong>Final Score</strong> = total weighted earned ÷ total weighted possible × 100.</li>
              <li>• Text, Info Block, and Sub-Category questions are not scored.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
