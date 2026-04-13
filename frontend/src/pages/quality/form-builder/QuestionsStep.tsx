import { useState, useMemo } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { Plus, ChevronsUpDown, ChevronsDownUp } from 'lucide-react'
import type { Form, FormQuestion, QuestionType } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { QuestionCard } from './QuestionCard'
import type { AllQuestionRef } from './questionCardTypes'

function buildAllQuestions(form: Form): AllQuestionRef[] {
  return form.categories.flatMap((c, ci) =>
    c.questions.map((q, qi) => ({
      id: q.id || -(ci * 1000 + qi + 1),
      text: q.question_text,
      type: q.question_type,
      catName: c.category_name,
      scaleMin: q.scale_min ?? 1,
      scaleMax: q.scale_max ?? 5,
      naAllowed: q.is_na_allowed ?? false,
      radioOptions: q.radio_options ?? [],
    }))
  )
}

function buildCategoryQuestions(form: Form, catIdx: number): AllQuestionRef[] {
  const c = form.categories[catIdx]
  if (!c) return []
  return c.questions.map((q, qi) => ({
    id: q.id || -(catIdx * 1000 + qi + 1),
    text: q.question_text,
    type: q.question_type,
    catName: c.category_name,
    scaleMin: q.scale_min ?? 1,
    scaleMax: q.scale_max ?? 5,
    naAllowed: q.is_na_allowed ?? false,
    radioOptions: q.radio_options ?? [],
  }))
}

function computeDependentCounts(questions: FormQuestion[], allQuestions: AllQuestionRef[]): Map<number, number> {
  const counts = new Map<number, number>()
  const allQIds = new Set(allQuestions.map(q => q.id))
  for (const q of questions) {
    const conds = q.conditions ?? []
    for (const c of conds) {
      if (c.target_question_id && allQIds.has(c.target_question_id)) {
        counts.set(c.target_question_id, (counts.get(c.target_question_id) ?? 0) + 1)
      }
    }
    if (!conds.length && q.conditional_question_id && allQIds.has(q.conditional_question_id)) {
      counts.set(q.conditional_question_id, (counts.get(q.conditional_question_id) ?? 0) + 1)
    }
  }
  return counts
}

function computeConditionalChildren(questions: FormQuestion[], catIdx: number, categoryQRefs: AllQuestionRef[]): Set<number> {
  const catQIds = new Set(categoryQRefs.map(q => q.id))
  const children = new Set<number>()
  questions.forEach((q, qi) => {
    const conds = q.conditions ?? []
    const hasCondInCat = conds.some(c => c.target_question_id && catQIds.has(c.target_question_id))
    const legacyInCat = !conds.length && q.conditional_question_id && catQIds.has(q.conditional_question_id)
    if (q.is_conditional && (hasCondInCat || legacyInCat)) {
      children.add(qi)
    }
  })
  return children
}

export function QuestionsStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const [activeCatIdx, setActiveCatIdx] = useState(0)
  const [newQText, setNewQText]         = useState('')
  const [newQType, setNewQType]         = useState<QuestionType>('YES_NO')
  const [expandedSet, setExpandedSet]   = useState<Set<number>>(new Set())

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const cat = form.categories[activeCatIdx]
  const allQuestions = useMemo(() => buildAllQuestions(form), [form])
  const categoryQuestions = useMemo(() => buildCategoryQuestions(form, activeCatIdx), [form, activeCatIdx])
  const qIds = (cat?.questions || []).map((_, qi) => `q-${qi}`)

  const allFormQuestions = useMemo(() => form.categories.flatMap(c => c.questions), [form])
  const dependentCounts = useMemo(
    () => computeDependentCounts(allFormQuestions, allQuestions),
    [allFormQuestions, allQuestions],
  )

  const conditionalChildren = useMemo(
    () => cat ? computeConditionalChildren(cat.questions, activeCatIdx, categoryQuestions) : new Set<number>(),
    [cat, activeCatIdx, categoryQuestions],
  )

  const toggleEdit = (qi: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev)
      if (next.has(qi)) next.delete(qi); else next.add(qi)
      return next
    })
  }

  const collapseOne = (qi: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev)
      next.delete(qi)
      return next
    })
  }

  const expandAll = () => {
    if (!cat) return
    setExpandedSet(new Set(cat.questions.map((_, i) => i)))
  }

  const collapseAll = () => setExpandedSet(new Set())

  const addQuestion = (andConfigure = false) => {
    if (!newQText.trim() || !cat) return
    const newQ: FormQuestion = {
      question_text: newQText.trim(), question_type: newQType,
      weight: 0, is_required: true, visible_to_csr: true,
    }
    const cats = [...form.categories]
    const newIdx = (cats[activeCatIdx].questions || []).length
    cats[activeCatIdx] = { ...cats[activeCatIdx], questions: [...(cats[activeCatIdx].questions || []), newQ] }
    onChange({ ...form, categories: cats }); setNewQText('')
    if (andConfigure) {
      setExpandedSet(prev => { const next = new Set(prev); next.add(newIdx); return next })
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !cat) return
    const from = parseInt(String(active.id).replace('q-', ''))
    const to   = parseInt(String(over.id).replace('q-', ''))
    const cats = [...form.categories]
    cats[activeCatIdx] = { ...cats[activeCatIdx], questions: arrayMove(cat.questions, from, to) }
    onChange({ ...form, categories: cats })
    setExpandedSet(prev => {
      const next = new Set<number>()
      for (const idx of prev) {
        if (idx === from) next.add(to)
        else if (from < to && idx > from && idx <= to) next.add(idx - 1)
        else if (from > to && idx >= to && idx < from) next.add(idx + 1)
        else next.add(idx)
      }
      return next
    })
  }

  const switchCategory = (i: number) => { setActiveCatIdx(i); setExpandedSet(new Set()); setNewQText('') }

  const someExpanded = expandedSet.size > 0
  const questionCount = cat?.questions?.length ?? 0

  return (
    <div className="flex gap-6">
      {/* ── Category sidebar ─────────────────────────────── */}
      <div className="w-64 shrink-0 space-y-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categories</p>
        {form.categories.map((c, i) => (
          <button key={i} onClick={() => switchCategory(i)}
            className={cn('w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
              i === activeCatIdx ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-600 hover:bg-slate-100')}>
            <div className="truncate font-medium">{c.category_name}</div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-slate-400">{c.questions?.length ?? 0} questions</span>
              <span className="text-xs font-semibold text-slate-500">{Math.round((c.weight || 0) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1 mt-1">
              <div className="h-1 rounded-full bg-primary/40 transition-all" style={{ width: `${Math.min(100, Math.round((c.weight || 0) * 100))}%` }} />
            </div>
          </button>
        ))}
      </div>

      {/* ── Main content ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{cat?.category_name}</h3>
          {questionCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{questionCount} question{questionCount !== 1 ? 's' : ''}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-500 px-2"
                onClick={someExpanded ? collapseAll : expandAll}>
                {someExpanded ? (
                  <><ChevronsDownUp className="h-3.5 w-3.5 mr-1" /> Collapse All</>
                ) : (
                  <><ChevronsUpDown className="h-3.5 w-3.5 mr-1" /> Expand All</>
                )}
              </Button>
            </div>
          )}
        </div>

        {cat ? (
          <>
            <div className="flex gap-2 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-slate-600">Question Text</Label>
                <Input value={newQText} onChange={e => setNewQText(e.target.value)}
                  placeholder="Type a question and click Add…" className="h-8 text-sm"
                  onKeyDown={e => e.key === 'Enter' && addQuestion()} />
              </div>
              <div className="w-36 space-y-1">
                <Label className="text-xs text-slate-600">Type</Label>
                <Select value={newQType} onValueChange={v => setNewQType(v as QuestionType)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES_NO">Yes / No</SelectItem>
                    <SelectItem value="SCALE">Scale</SelectItem>
                    <SelectItem value="TEXT">Text</SelectItem>
                    <SelectItem value="INFO_BLOCK">Info Block</SelectItem>
                    <SelectItem value="RADIO">Radio</SelectItem>
                    <SelectItem value="MULTI_SELECT">Multi-Select</SelectItem>
                    <SelectItem value="SUB_CATEGORY">Sub-Category</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => addQuestion(false)} disabled={!newQText.trim()}
                className="bg-primary hover:bg-primary/90 text-white h-8">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => addQuestion(true)} disabled={!newQText.trim()}
                className="h-8 text-xs border-primary text-primary hover:bg-primary/10 whitespace-nowrap">
                Add & Configure
              </Button>
            </div>

            {cat.questions?.length ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={qIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {cat.questions.map((q, qi) => {
                      const qId = q.id || -(activeCatIdx * 1000 + qi + 1)
                      const stableKey = q.id ? `qid-${q.id}` : `new-${qi}-${q.question_text.substring(0, 20)}`
                      return (
                        <QuestionCard
                          key={stableKey} q={q} qi={qi} catIdx={activeCatIdx}
                          form={form} onChange={onChange}
                          allQuestions={allQuestions}
                          categoryQuestions={categoryQuestions}
                          isEditing={expandedSet.has(qi)}
                          onToggleEdit={toggleEdit}
                          onCancelEdit={collapseOne}
                          dependentCount={dependentCounts.get(qId) ?? 0}
                          isConditionalChild={conditionalChildren.has(qi)}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-sm">
                No questions yet. Type above and click Add.
              </div>
            )}
          </>
        ) : (
          <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-sm">
            No categories — add categories first.
          </div>
        )}
      </div>
    </div>
  )
}
