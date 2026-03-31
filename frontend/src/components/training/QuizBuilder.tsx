import { useState } from 'react'
import { Plus, Trash2, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import { cn } from '@/lib/utils'
import type { ListItem } from '@/services/listService'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BuilderQuestion {
  question_text: string
  options: string[]
  correct_option: number
}

export interface QuizBuilderData {
  quiz_title: string
  pass_score: number
  topic_id?: number
  topic_ids?: number[]
  is_active?: boolean
  questions: BuilderQuestion[]
}

export interface QuizBuilderErrors {
  quiz_title?: string
  pass_score?: string
  questions?: string
  [key: string]: string | undefined
}

interface QuizBuilderProps {
  value: QuizBuilderData
  onChange: (data: QuizBuilderData) => void
  errors: QuizBuilderErrors
  topics: ListItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyQuestion(): BuilderQuestion {
  return { question_text: '', options: ['', ''], correct_option: 0 }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuizBuilder({ value, onChange, errors, topics }: QuizBuilderProps) {
  const update = (patch: Partial<QuizBuilderData>) => onChange({ ...value, ...patch })

  const addQuestion = () => update({ questions: [...value.questions, emptyQuestion()] })

  const removeQuestion = (idx: number) =>
    update({ questions: value.questions.filter((_, i) => i !== idx) })

  const updateQuestion = (idx: number, field: keyof BuilderQuestion, val: string | number | string[]) => {
    const qs = value.questions.map((q, i) => i === idx ? { ...q, [field]: val } : q)
    update({ questions: qs })
  }

  const addOption = (qIdx: number) => {
    const qs = value.questions.map((q, i) =>
      i === qIdx && q.options.length < 4 ? { ...q, options: [...q.options, ''] } : q
    )
    update({ questions: qs })
  }

  const removeOption = (qIdx: number, oIdx: number) => {
    const qs = value.questions.map((q, i) => {
      if (i !== qIdx) return q
      const options = q.options.filter((_, oi) => oi !== oIdx)
      const correct = q.correct_option >= oIdx && q.correct_option > 0
        ? q.correct_option - 1 : q.correct_option
      return { ...q, options, correct_option: correct }
    })
    update({ questions: qs })
  }

  const updateOption = (qIdx: number, oIdx: number, val: string) => {
    const qs = value.questions.map((q, i) =>
      i === qIdx ? { ...q, options: q.options.map((o, oi) => oi === oIdx ? val : o) } : q
    )
    update({ questions: qs })
  }

  const sel = 'w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40'

  return (
    <div className="space-y-5">
      {/* Metadata */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="text-[12px] font-medium text-slate-700 block mb-1">Quiz Title <span className="text-red-500">*</span></label>
          <Input value={value.quiz_title} onChange={e => update({ quiz_title: e.target.value })}
            placeholder="e.g. Wrap-Up Process Quiz" className="text-[13px]" />
          {errors.quiz_title && <p className="text-[11px] text-red-600 mt-1">{errors.quiz_title}</p>}
        </div>
        <div>
          <label className="text-[12px] font-medium text-slate-700 block mb-1">Pass Score (%) <span className="text-red-500">*</span></label>
          <Input type="number" min={1} max={100} value={value.pass_score}
            onChange={e => update({ pass_score: Number(e.target.value) })} className="text-[13px]" />
          {errors.pass_score && <p className="text-[11px] text-red-600 mt-1">{errors.pass_score}</p>}
        </div>
      </div>

      <div>
        <label className="text-[12px] font-medium text-slate-700 block mb-1">Topics <span className="text-slate-400 font-normal">(optional)</span></label>
        <SearchableMultiSelect
          items={topics.map(t => ({ id: t.id, label: t.label }))}
          selectedIds={value.topic_ids ?? []}
          onChange={ids => update({ topic_ids: ids, topic_id: ids[0] })}
          placeholder="No topics selected"
          emptyMessage="No topics match"
        />
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Questions</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-semibold text-slate-700">
            {value.questions.length > 0 ? `${value.questions.length} question${value.questions.length !== 1 ? 's' : ''}` : 'No questions yet'}
          </p>
          <Button variant="outline" size="sm" onClick={addQuestion}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Question
          </Button>
        </div>
        {errors.questions && <p className="text-[12px] text-red-600 mb-3">{errors.questions}</p>}

        {value.questions.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
            <HelpCircle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-[13px] text-slate-400">No questions yet — add your first question</p>
          </div>
        ) : (
          <div className="space-y-3">
            {value.questions.map((q, qIdx) => {
              const qErr = errors[`q_${qIdx}`]
              return (
                <div key={qIdx} className={cn('border rounded-xl p-4', qErr ? 'border-red-300' : 'border-slate-200')}>
                  {/* Question header */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12px] font-semibold text-slate-500">Question {qIdx + 1}</span>
                    <button onClick={() => removeQuestion(qIdx)}
                      className="text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <Input value={q.question_text} onChange={e => updateQuestion(qIdx, 'question_text', e.target.value)}
                    placeholder="Enter question…" className="text-[13px] mb-3" />

                  {/* Options */}
                  <div className="space-y-2">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className={cn('flex items-center gap-2 p-2 rounded-lg border',
                        q.correct_option === oIdx ? 'border-primary/40 bg-blue-50/50' : 'border-transparent bg-slate-50')}>
                        <input type="radio" name={`correct-${qIdx}`} checked={q.correct_option === oIdx}
                          onChange={() => updateQuestion(qIdx, 'correct_option', oIdx)}
                          className="h-4 w-4 text-primary shrink-0" />
                        <Input value={opt} onChange={e => updateOption(qIdx, oIdx, e.target.value)}
                          placeholder={`Option ${String.fromCharCode(65 + oIdx)}`}
                          className="flex-1 h-7 text-[12px] border-0 bg-transparent focus-visible:ring-0 px-1" />
                        {q.options.length > 2 && (
                          <button onClick={() => removeOption(qIdx, oIdx)}
                            className="text-slate-300 hover:text-red-400 shrink-0">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {q.options.length < 4 && (
                      <button onClick={() => addOption(qIdx)}
                        className="text-[12px] text-slate-400 hover:text-primary transition-colors flex items-center gap-1 mt-1">
                        <Plus className="h-3.5 w-3.5" /> Add option
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">Select the radio button next to the correct answer</p>
                  {qErr && <p className="text-[11px] text-red-600 mt-1">{qErr}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateQuizBuilder(data: QuizBuilderData): QuizBuilderErrors {
  const errors: QuizBuilderErrors = {}
  if (!data.quiz_title.trim()) errors.quiz_title = 'Quiz title is required'
  if (!data.pass_score || data.pass_score < 1 || data.pass_score > 100)
    errors.pass_score = 'Pass score must be between 1 and 100'
  if (data.questions.length === 0) errors.questions = 'Add at least one question'
  data.questions.forEach((q, idx) => {
    if (!q.question_text.trim()) { errors[`q_${idx}`] = 'Question text is required'; return }
    const filled = q.options.filter(o => o.trim())
    if (filled.length < 2) errors[`q_${idx}`] = 'At least 2 non-empty options required'
  })
  return errors
}
