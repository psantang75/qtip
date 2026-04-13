import React, { useState, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Pencil } from 'lucide-react'
import type {
  Form, FormQuestion, FormQuestionCondition, RadioOption,
  QuestionType, ConditionType, LogicalOperator,
} from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ConditionSummary } from './ConditionSummary'
import { QuestionEditPanel } from './QuestionEditPanel'
import type { AllQuestionRef } from './questionCardTypes'
import { ensureRadioOptionValues, nextIncrementalOptionValue } from './formBuilderUtils'

function parseConditionGroups(q: FormQuestion): FormQuestionCondition[][] {
  const src = q.conditions && q.conditions.length > 0
    ? q.conditions
    : q.conditional_question_id
      ? [{ target_question_id: q.conditional_question_id, condition_type: (q.condition_type as ConditionType) ?? 'EQUALS', target_value: q.conditional_value ?? '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]
      : []
  if (src.length === 0) return [[{ target_question_id: 0, condition_type: 'EQUALS' as ConditionType, target_value: '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]]
  const byGroup: Record<number, FormQuestionCondition[]> = {}
  src.forEach(c => { const g = c.group_id ?? 0; if (!byGroup[g]) byGroup[g] = []; byGroup[g].push(c) })
  return Object.values(byGroup)
}

function getAllConditions(q: FormQuestion): FormQuestionCondition[] {
  return q.conditions ?? (q.conditional_question_id
    ? [{ target_question_id: q.conditional_question_id, condition_type: (q.condition_type as ConditionType) ?? 'EQUALS', target_value: q.conditional_value ?? '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]
    : [])
}

const TYPE_LABELS: Record<string, string> = {
  YES_NO: 'Yes / No', SCALE: 'Scale', TEXT: 'Text', INFO_BLOCK: 'Info',
  RADIO: 'Radio', MULTI_SELECT: 'Multi-Select', SUB_CATEGORY: 'Sub-Category',
}

function scoringText(q: FormQuestion): string {
  if (q.question_type === 'YES_NO') return `Yes: ${q.yes_value ?? 1}  |  No: ${q.no_value ?? 0}${q.is_na_allowed ? `  |  N/A: ${q.na_value ?? 0}` : ''}`
  if (q.question_type === 'SCALE') return `Range: ${q.scale_min ?? 1} – ${q.scale_max ?? 5}${q.is_na_allowed ? '  |  N/A allowed' : ''}`
  if (q.question_type === 'RADIO' || q.question_type === 'MULTI_SELECT') {
    const opts = q.radio_options ?? []
    const maxScore = opts.length ? Math.max(...opts.map(o => o.score ?? 0)) : 0
    return `${opts.length} option${opts.length !== 1 ? 's' : ''}  |  Max: ${maxScore} pts`
  }
  if (q.question_type === 'TEXT') return 'Free text (not scored)'
  if (q.question_type === 'INFO_BLOCK') return 'Information only (not scored)'
  if (q.question_type === 'SUB_CATEGORY') return 'Sub-category header (not scored)'
  return ''
}

export function QuestionCard({ q, qi, catIdx, form, onChange, allQuestions, categoryQuestions, isEditing, onToggleEdit, onCancelEdit, dependentCount, isConditionalChild }: {
  q: FormQuestion; qi: number; catIdx: number
  form: Form; onChange: (f: Form) => void
  allQuestions: AllQuestionRef[]
  categoryQuestions: AllQuestionRef[]
  isEditing: boolean
  onToggleEdit: (qi: number) => void
  onCancelEdit: (qi: number) => void
  dependentCount: number
  isConditionalChild: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `q-${qi}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const [lText, setLText]         = useState(q.question_text)
  const [lType, setLType]         = useState<QuestionType>(q.question_type)
  const [lRequired, setLRequired] = useState(q.is_required ?? true)
  const [lVisible, setLVisible]   = useState(q.visible_to_csr !== false)
  const [lNa, setLNa]             = useState(q.is_na_allowed ?? false)
  const [lYes, setLYes]           = useState(q.yes_value ?? 1)
  const [lNo, setLNo]             = useState(q.no_value ?? 0)
  const [lNaVal, setLNaVal]       = useState(q.na_value ?? 0)
  const [lScaleMin, setLScaleMin] = useState(q.scale_min ?? 1)
  const [lScaleMax, setLScaleMax] = useState(q.scale_max ?? 5)
  const [lRadio, setLRadio]       = useState<RadioOption[]>(() =>
    (q.radio_options ?? []).map(o => ({ ...o, has_free_text: false })),
  )
  const [newOptText, setNewOptText] = useState('')
  const [newOptScore, setNewOptScore] = useState(0)
  const [lCond, setLCond] = useState(q.is_conditional ?? false)
  const [lGroups, setLGroups] = useState<FormQuestionCondition[][]>(() => parseConditionGroups(q))
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditing) return
    setLText(q.question_text); setLType(q.question_type)
    setLRequired(q.is_required ?? true); setLVisible(q.visible_to_csr !== false)
    setLNa(q.is_na_allowed ?? false)
    setLYes(q.yes_value ?? 1); setLNo(q.no_value ?? 0); setLNaVal(q.na_value ?? 0)
    setLScaleMin(q.scale_min ?? 1); setLScaleMax(q.scale_max ?? 5)
    setLRadio((q.radio_options ?? []).map(o => ({ ...o, has_free_text: false })))
    setLCond(q.is_conditional ?? false)
    setLGroups(parseConditionGroups(q))
    setErr(null)
  }, [isEditing, q])

  const hasOptions = lType === 'RADIO' || lType === 'MULTI_SELECT'

  const saveEdit = () => {
    if (!lText.trim()) { setErr('Question text is required'); return }
    if (hasOptions && lRadio.length === 0) { setErr('Add at least one option'); return }
    if (lType === 'SCALE' && lScaleMin >= lScaleMax) { setErr('Scale min must be less than max'); return }
    if (lCond && lGroups.some(g => g.some(c => !c.target_question_id))) { setErr('All conditions need a source question'); return }
    const flatConditions: FormQuestionCondition[] = lGroups.flatMap((group, gIdx) =>
      group.map((c, ci) => ({ ...c, group_id: gIdx, sort_order: ci, logical_operator: 'AND' as LogicalOperator }))
    )
    const updated: FormQuestion = {
      ...q, question_text: lText.trim(), question_type: lType, weight: 0,
      is_required: lRequired, visible_to_csr: lVisible, is_na_allowed: lNa,
      ...(lType === 'YES_NO' && { yes_value: lYes, no_value: lNo, ...(lNa && { na_value: lNaVal }) }),
      ...(lType === 'SCALE' && { scale_min: lScaleMin, scale_max: lScaleMax }),
      ...(hasOptions && {
        radio_options: ensureRadioOptionValues(lRadio).map(o => ({ ...o, has_free_text: false })),
      }),
      is_conditional: lCond,
      ...(lCond ? { conditions: flatConditions } : { conditions: [] }),
    }
    const cats = [...form.categories]
    const qs = [...cats[catIdx].questions]; qs[qi] = updated
    cats[catIdx] = { ...cats[catIdx], questions: qs }
    onChange({ ...form, categories: cats }); onCancelEdit(qi)
  }

  const removeQ = () => {
    const cats = [...form.categories]
    cats[catIdx] = { ...cats[catIdx], questions: cats[catIdx].questions.filter((_, i) => i !== qi) }
    onChange({ ...form, categories: cats }); onCancelEdit(qi)
  }

  const addOpt = () => {
    if (!newOptText.trim()) { setErr('Option label is required'); return }
    const option_value = nextIncrementalOptionValue(lRadio)
    setLRadio([...lRadio, {
      option_text: newOptText.trim(),
      option_value,
      score: newOptScore,
      has_free_text: false,
    }])
    setNewOptText(''); setNewOptScore(0); setErr(null)
  }

  const quickToggleVisible = (e: React.MouseEvent) => {
    e.stopPropagation()
    const cats = [...form.categories]
    const qs = [...cats[catIdx].questions]
    qs[qi] = { ...qs[qi], visible_to_csr: q.visible_to_csr === false }
    cats[catIdx] = { ...cats[catIdx], questions: qs }
    onChange({ ...form, categories: cats })
  }

  const isVisible = q.visible_to_csr !== false
  const condCount = (q.conditions?.length ?? 0) || (q.is_conditional ? 1 : 0)
  const allConditions = getAllConditions(q)
  const hasConditions = condCount > 0

  return (
    <div ref={setNodeRef} style={style}
      className={cn(
        'rounded-lg border transition-all',
        isDragging ? 'shadow-lg' : '',
        isEditing ? 'border-primary shadow-sm' : 'border-slate-200 bg-white',
        isConditionalChild && !isEditing && 'ml-8 border-l-[3px] border-l-primary/40',
      )}>

      {/* Collapsed / header */}
      <div
        className={cn('px-4 py-3', isEditing ? 'bg-primary/5 rounded-t-lg' : 'cursor-pointer hover:bg-slate-50/80 rounded-lg')}
        onClick={() => !isEditing && onToggleEdit(qi)}
      >
        <div className="flex items-start gap-3">
          <button {...attributes} {...listeners} onClick={e => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 shrink-0 touch-none mt-0.5">
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className={cn('text-sm font-medium leading-snug', isEditing ? 'text-primary' : 'text-slate-900')}>
              {q.question_text}
            </p>
            {!isEditing && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                <div><span className="text-slate-400 block">Type</span><span className="text-slate-700 font-medium">{TYPE_LABELS[q.question_type] ?? q.question_type}</span></div>
                <div><span className="text-slate-400 block">Scoring</span><span className="text-slate-600">{scoringText(q)}</span></div>
                <div><span className="text-slate-400 block">Required</span><span className={cn('font-medium', q.is_required !== false ? 'text-slate-700' : 'text-slate-400')}>{q.is_required !== false ? 'Yes' : 'No'}</span></div>
                <div><span className="text-slate-400 block">CSR Visible</span><button onClick={quickToggleVisible} title="Click to toggle" className={cn('font-medium', isVisible ? 'text-emerald-600' : 'text-slate-400')}>{isVisible ? 'Yes' : 'No'}</button></div>
                {dependentCount > 0 && <div><span className="text-slate-400 block">Dependents</span><span className="text-amber-700 font-medium">{dependentCount}</span></div>}
              </div>
            )}
            {hasConditions && !isEditing && (
              <div className="mt-2">
                <ConditionSummary conditions={allConditions} allQuestions={allQuestions} />
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className={cn('h-7 w-7', isEditing ? 'text-primary' : '')} onClick={() => onToggleEdit(qi)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={removeQ}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </div>

      {/* Expanded edit panel */}
      {isEditing && (
        <QuestionEditPanel
          qi={qi}
          state={{ lText, lType, lRequired, lVisible, lNa, lYes, lNo, lNaVal, lScaleMin, lScaleMax, lRadio, newOptText, newOptScore, lCond, lGroups, err }}
          actions={{ setLText, setLType, setLRequired, setLVisible, setLNa, setLYes, setLNo, setLNaVal, setLScaleMin, setLScaleMax, setLRadio, setNewOptText, setNewOptScore, setLCond, setLGroups, setErr, addOpt, saveEdit, onCancelEdit: () => onCancelEdit(qi) }}
          categoryQuestions={categoryQuestions}
        />
      )}
    </div>
  )
}
