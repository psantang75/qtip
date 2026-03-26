import React, { useState, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, Pencil, CheckCircle2 } from 'lucide-react'
import type {
  Form, FormQuestion, FormQuestionCondition, RadioOption,
  QuestionType, ConditionType, LogicalOperator,
} from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ── Sortable question row ─────────────────────────────────────────────────────
function SortableQuestionRow({ q, qi, catIdx, form, onChange, allQuestions, isEditing, onStartEdit, onCancelEdit }: {
  q: FormQuestion; qi: number; catIdx: number
  form: Form; onChange: (f: Form) => void
  allQuestions: { id: number; text: string; type: string; catName: string; scaleMin: number; scaleMax: number; naAllowed: boolean; radioOptions: RadioOption[] }[]
  isEditing: boolean
  onStartEdit: (qi: number) => void
  onCancelEdit: () => void
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
  const [lRadio, setLRadio]       = useState<RadioOption[]>(q.radio_options ?? [])
  const [newOptText, setNewOptText] = useState('')
  const [newOptVal, setNewOptVal]   = useState('')
  const [newOptScore, setNewOptScore] = useState(0)
  const [newOptFree, setNewOptFree]  = useState(false)
  const [lCond, setLCond] = useState(q.is_conditional ?? false)
  const [lGroups, setLGroups] = useState<FormQuestionCondition[][]>(() => {
    const src = q.conditions && q.conditions.length > 0
      ? q.conditions
      : q.conditional_question_id
        ? [{ target_question_id: q.conditional_question_id, condition_type: (q.condition_type as ConditionType) ?? 'EQUALS', target_value: q.conditional_value ?? '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]
        : []
    if (src.length === 0) return [[{ target_question_id: 0, condition_type: 'EQUALS' as ConditionType, target_value: '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]]
    const byGroup: Record<number, FormQuestionCondition[]> = {}
    src.forEach(c => { const g = c.group_id ?? 0; if (!byGroup[g]) byGroup[g] = []; byGroup[g].push(c) })
    return Object.values(byGroup)
  })
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditing) return
    setLText(q.question_text); setLType(q.question_type)
    setLRequired(q.is_required ?? true); setLVisible(q.visible_to_csr !== false)
    setLNa(q.is_na_allowed ?? false)
    setLYes(q.yes_value ?? 1); setLNo(q.no_value ?? 0); setLNaVal(q.na_value ?? 0)
    setLScaleMin(q.scale_min ?? 1); setLScaleMax(q.scale_max ?? 5)
    setLRadio(q.radio_options ?? [])
    setLCond(q.is_conditional ?? false)
    const src = q.conditions && q.conditions.length > 0
      ? q.conditions
      : q.conditional_question_id
        ? [{ target_question_id: q.conditional_question_id, condition_type: (q.condition_type as ConditionType) ?? 'EQUALS', target_value: q.conditional_value ?? '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]
        : []
    if (src.length === 0) {
      setLGroups([[{ target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: 0, sort_order: 0 }]])
    } else {
      const byGroup: Record<number, FormQuestionCondition[]> = {}
      src.forEach(c => { const g = c.group_id ?? 0; if (!byGroup[g]) byGroup[g] = []; byGroup[g].push(c) })
      setLGroups(Object.values(byGroup))
    }
    setErr(null)
  }, [isEditing, q])

  const noPoints  = lType === 'INFO_BLOCK' || lType === 'TEXT' || lType === 'SUB_CATEGORY'
  const hasOptions = lType === 'RADIO' || lType === 'MULTI_SELECT'
  const needsValue = (ct: ConditionType) => ct === 'EQUALS' || ct === 'NOT_EQUALS'

  const saveEdit = () => {
    if (!lText.trim()) { setErr('Question text is required'); return }
    if (hasOptions && lRadio.length === 0) { setErr('Add at least one option'); return }
    if (lType === 'SCALE' && lScaleMin >= lScaleMax) { setErr('Scale min must be less than max'); return }
    if (lCond && lGroups.some(g => g.some(c => !c.target_question_id))) { setErr('All conditions need a source question'); return }

    const flatConditions: FormQuestionCondition[] = lGroups.flatMap((group, gIdx) =>
      group.map((c, ci) => ({ ...c, group_id: gIdx, sort_order: ci, logical_operator: 'AND' as LogicalOperator }))
    )
    const updated: FormQuestion = {
      ...q,
      question_text: lText.trim(), question_type: lType, weight: 0,
      is_required: lRequired, visible_to_csr: lVisible, is_na_allowed: lNa,
      ...(lType === 'YES_NO' && { yes_value: lYes, no_value: lNo, ...(lNa && { na_value: lNaVal }) }),
      ...(lType === 'SCALE' && { scale_min: lScaleMin, scale_max: lScaleMax }),
      ...(hasOptions && { radio_options: lRadio }),
      is_conditional: lCond,
      ...(lCond ? { conditions: flatConditions } : { conditions: [] }),
    }
    const cats = [...form.categories]
    const qs = [...cats[catIdx].questions]; qs[qi] = updated
    cats[catIdx] = { ...cats[catIdx], questions: qs }
    onChange({ ...form, categories: cats }); onCancelEdit()
  }

  const removeQ = () => {
    const cats = [...form.categories]
    cats[catIdx] = { ...cats[catIdx], questions: cats[catIdx].questions.filter((_, i) => i !== qi) }
    onChange({ ...form, categories: cats }); onCancelEdit()
  }

  const addOpt = () => {
    if (!newOptText || !newOptVal) { setErr('Option text and value are required'); return }
    setLRadio([...lRadio, { option_text: newOptText, option_value: newOptVal, score: newOptScore, has_free_text: newOptFree }])
    setNewOptText(''); setNewOptVal(''); setNewOptScore(0); setNewOptFree(false); setErr(null)
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

  const pointSummary = () => {
    if (q.question_type === 'YES_NO')   return `Y:${q.yes_value ?? 1} N:${q.no_value ?? 0}`
    if (q.question_type === 'SCALE')    return `${q.scale_min ?? 1}–${q.scale_max ?? 5} pts`
    if (q.question_type === 'RADIO' || q.question_type === 'MULTI_SELECT') return `${q.radio_options?.length ?? 0} opts`
    return null
  }

  return (
    <div ref={setNodeRef} style={style}
      className={cn('rounded-lg border transition-all', isDragging ? 'shadow-lg' : '',
        isEditing ? 'border-primary shadow-sm' : 'border-slate-200 bg-white')}>

      <div className={cn('flex items-start gap-2 px-3 py-2.5', isEditing ? 'bg-primary/5 rounded-t-lg' : '')}>
        <button {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 shrink-0 touch-none mt-0.5">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium', isEditing ? 'text-primary' : 'text-slate-900')}>
            {q.question_text}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{q.question_type}</Badge>
            {pointSummary() && <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-slate-600">{pointSummary()}</Badge>}
            {q.is_na_allowed && <Badge variant="outline" className="text-[10px] h-4 px-1.5">N/A</Badge>}
            {condCount > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-primary border-primary/30">
                {condCount} condition{condCount > 1 ? 's' : ''}
              </Badge>
            )}
            <button onClick={quickToggleVisible} title="Click to toggle visibility"
              className={cn('inline-flex items-center h-4 px-1.5 rounded-sm border text-[10px] font-semibold transition-colors',
                isVisible ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200')}>
              {isVisible ? '● Visible' : '○ Hidden'}
            </button>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className={cn('h-7 w-7', isEditing ? 'text-primary' : '')}
            onClick={() => isEditing ? undefined : onStartEdit(qi)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
            onClick={removeQ}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="px-3 pb-3 pt-3 border-t border-primary/20 bg-white rounded-b-lg space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{err}</div>}

          <div className="space-y-1">
            <Label className="text-xs">Question Text <span className="text-red-500">*</span></Label>
            <Textarea value={lText} onChange={e => setLText(e.target.value)} rows={2} className="text-sm resize-none" autoFocus />
          </div>

          <div className="space-y-1 max-w-xs">
            <Label className="text-xs">Question Type</Label>
            <Select value={lType} onValueChange={v => { setLType(v as QuestionType); setErr(null) }}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES_NO">Yes / No</SelectItem>
                <SelectItem value="SCALE">Scale</SelectItem>
                <SelectItem value="TEXT">Text Input</SelectItem>
                <SelectItem value="INFO_BLOCK">Information Block</SelectItem>
                <SelectItem value="RADIO">Radio (single select)</SelectItem>
                <SelectItem value="MULTI_SELECT">Multi-Select (checkboxes)</SelectItem>
                <SelectItem value="SUB_CATEGORY">Sub-Category</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!noPoints && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-700">Point Values</p>
              {lType === 'YES_NO' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Yes</Label>
                    <Input type="number" min={0} step={1} value={lYes} onChange={e => setLYes(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">No</Label>
                    <Input type="number" min={0} step={1} value={lNo} onChange={e => setLNo(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                  {lNa && (
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">N/A</Label>
                      <Input type="number" min={0} step={1} value={lNaVal} onChange={e => setLNaVal(Number(e.target.value))} className="h-8 text-sm" />
                    </div>
                  )}
                </div>
              )}
              {lType === 'SCALE' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Min Value (points)</Label>
                    <Input type="number" value={lScaleMin} onChange={e => setLScaleMin(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Max Value (points)</Label>
                    <Input type="number" value={lScaleMax} onChange={e => setLScaleMax(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                </div>
              )}
              {hasOptions && (
                <p className="text-[11px] text-slate-500">
                  {lType === 'MULTI_SELECT' ? 'Each option has its own point value. Final score = sum of all checked options.' : 'Each option has its own point value below.'}
                </p>
              )}
            </div>
          )}

          {hasOptions && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                {lType === 'MULTI_SELECT' ? 'Checkbox Options' : 'Radio Options'}
              </p>
              <div className="grid grid-cols-12 gap-2 items-center">
                <Input value={newOptText} onChange={e => setNewOptText(e.target.value)} placeholder="Label" className="h-7 text-xs col-span-4" />
                <Input value={newOptVal} onChange={e => setNewOptVal(e.target.value)} placeholder="Value" className="h-7 text-xs col-span-3" />
                <Input type="number" value={newOptScore} onChange={e => setNewOptScore(Number(e.target.value))} placeholder="Pts" className="h-7 text-xs col-span-2" step={1} />
                <div className="col-span-3 flex items-center gap-1">
                  <Button size="sm" onClick={addOpt} className="h-7 text-xs bg-primary hover:bg-primary/90 text-white px-2 flex-1">Add</Button>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer shrink-0">
                    <input type="checkbox" checked={newOptFree} onChange={e => setNewOptFree(e.target.checked)} className="h-3 w-3" />Free
                  </label>
                </div>
              </div>
              {lRadio.map((opt, i) => (
                <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-xs">
                  <span className="font-medium flex-1 truncate">{opt.option_text}</span>
                  <span className="text-slate-400">({opt.option_value})</span>
                  <span className="font-medium text-slate-700">{opt.score} pts</span>
                  {opt.has_free_text && <span className="text-primary">+Free</span>}
                  <button onClick={() => setLRadio(lRadio.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 ml-1 font-bold">×</button>
                </div>
              ))}
            </div>
          )}

          {(lType === 'YES_NO' || lType === 'SCALE') && (
            <div className="flex items-center gap-1.5">
              <input type="checkbox" id={`na-${qi}`} checked={lNa} onChange={e => setLNa(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
              <label htmlFor={`na-${qi}`} className="text-xs text-slate-700 cursor-pointer">Allow N/A answer</label>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <input type="checkbox" id={`cond-${qi}`} checked={lCond} onChange={e => setLCond(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
              <label htmlFor={`cond-${qi}`} className="text-xs font-medium text-slate-700 cursor-pointer">
                Conditional Logic — only show this question when conditions are met
              </label>
            </div>

            {lCond && (
              <div className="border border-slate-300 bg-slate-50 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Conditions</p>
                  <p className="text-[10px] text-slate-400">AND within groups · OR between groups</p>
                </div>

                {lGroups.map((group, gIdx) => (
                  <div key={gIdx}>
                    {gIdx > 0 && (
                      <div className="flex items-center gap-2 my-2">
                        <div className="flex-1 h-px bg-slate-300" />
                        <span className="text-[11px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 border border-slate-300 rounded-full">OR</span>
                        <div className="flex-1 h-px bg-slate-300" />
                      </div>
                    )}

                    <div className="bg-white border border-primary/40 rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">
                          {lGroups.length > 1 ? `Group ${gIdx + 1} — ALL must match` : 'ALL must match'}
                        </span>
                        {lGroups.length > 1 && (
                          <button onClick={() => setLGroups(prev => prev.filter((_, i) => i !== gIdx))}
                            className="text-[10px] text-red-400 hover:text-red-600">Remove group</button>
                        )}
                      </div>

                      {group.map((cond, ci) => {
                        const selectedQ = allQuestions.find(q => q.id === cond.target_question_id)
                        const valueOptions: { label: string; value: string }[] = !selectedQ ? [] :
                          selectedQ.type === 'YES_NO' ? [
                            { label: 'Yes', value: 'YES' },
                            { label: 'No', value: 'NO' },
                            ...(selectedQ.naAllowed ? [{ label: 'N/A', value: 'N/A' }] : []),
                          ] :
                          selectedQ.type === 'SCALE' ? Array.from({ length: selectedQ.scaleMax - selectedQ.scaleMin + 1 }, (_, i) => {
                            const v = String(selectedQ.scaleMin + i)
                            return { label: v, value: v }
                          }) :
                          selectedQ.type === 'RADIO' ? selectedQ.radioOptions.map(o => ({ label: o.option_text, value: o.option_value })) :
                          []

                        const updateCond = (patch: Partial<FormQuestionCondition>) =>
                          setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g :
                            g.map((c, ci2) => ci2 !== ci ? c : { ...c, ...patch })))

                        return (
                          <div key={ci}>
                            {ci > 0 && (
                              <div className="flex items-center gap-2 my-1.5">
                                <div className="w-4 h-px bg-primary/30" />
                                <span className="text-[10px] font-bold text-primary">AND</span>
                                <div className="flex-1 h-px bg-primary/30" />
                              </div>
                            )}
                            <div className="grid grid-cols-12 gap-1.5 items-center">
                              <div className="col-span-4">
                                <Select
                                  value={cond.target_question_id ? String(cond.target_question_id) : ''}
                                  onValueChange={v => updateCond({ target_question_id: v ? Number(v) : 0, target_value: '' })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Question…" /></SelectTrigger>
                                  <SelectContent>
                                    {allQuestions.filter(q => ['YES_NO','SCALE','RADIO'].includes(q.type)).map(q => (
                                      <SelectItem key={q.id} value={String(q.id)} className="text-xs">
                                        {q.catName}: {q.text.substring(0, 24)}{q.text.length > 24 ? '…' : ''}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="col-span-3">
                                <Select value={cond.condition_type} onValueChange={v => updateCond({ condition_type: v as ConditionType })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="EQUALS">Equals</SelectItem>
                                    <SelectItem value="NOT_EQUALS">Not Equals</SelectItem>
                                    <SelectItem value="EXISTS">Has any answer</SelectItem>
                                    <SelectItem value="NOT_EXISTS">Has no answer</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="col-span-4">
                                {needsValue(cond.condition_type) ? (
                                  valueOptions.length > 0 ? (
                                    <Select value={cond.target_value ?? ''} onValueChange={v => updateCond({ target_value: v })}>
                                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select value…" /></SelectTrigger>
                                      <SelectContent>
                                        {valueOptions.map(opt => (
                                          <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <div className="h-7 flex items-center">
                                      <span className="text-[10px] text-slate-400 italic pl-1">
                                        {cond.target_question_id ? 'No options available' : '← Select a question first'}
                                      </span>
                                    </div>
                                  )
                                ) : (
                                  <div className="h-7 flex items-center">
                                    <span className="text-[10px] text-slate-400 italic pl-1">no value needed</span>
                                  </div>
                                )}
                              </div>
                              <div className="col-span-1 flex justify-center">
                                {group.length > 1 && (
                                  <button
                                    onClick={() => setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g : g.filter((_, ci2) => ci2 !== ci)))}
                                    className="text-red-400 hover:text-red-600 font-bold leading-none text-base">×</button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      <Button variant="ghost" size="sm" className="h-6 text-[11px] text-primary px-0"
                        onClick={() => setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g :
                          [...g, { target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: gIdx, sort_order: g.length }]))}>
                        <Plus className="h-2.5 w-2.5 mr-0.5" /> Add AND condition
                      </Button>
                    </div>
                  </div>
                ))}

                <Button variant="ghost" size="sm" className="h-7 text-xs w-full border border-dashed border-slate-300 text-slate-500 hover:border-primary hover:text-primary rounded-lg"
                  onClick={() => setLGroups(prev => [...prev, [{ target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: prev.length, sort_order: 0 }]])}>
                  <Plus className="h-3 w-3 mr-1" /> Add OR Group
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-5 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <Switch checked={lRequired} onCheckedChange={setLRequired} />
              <Label className="text-xs cursor-pointer">Required</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={lVisible} onCheckedChange={setLVisible} />
              <Label className="text-xs cursor-pointer">Visible to User</Label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white h-8 px-4"
              onClick={saveEdit} disabled={!lText.trim()}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-4" onClick={onCancelEdit}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Questions ─────────────────────────────────────────────────────────
export function QuestionsStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const [activeCatIdx, setActiveCatIdx] = useState(0)
  const [newQText, setNewQText]         = useState('')
  const [newQType, setNewQType]         = useState<QuestionType>('YES_NO')
  const [editQIdx, setEditQIdx]         = useState<number | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const cat = form.categories[activeCatIdx]
  const allQuestions = form.categories.flatMap((c, ci) =>
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
  const qIds = (cat?.questions || []).map((_, qi) => `q-${qi}`)

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
    if (andConfigure) setEditQIdx(newIdx)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !cat) return
    const from = parseInt(String(active.id).replace('q-', ''))
    const to   = parseInt(String(over.id).replace('q-', ''))
    const cats = [...form.categories]
    cats[activeCatIdx] = { ...cats[activeCatIdx], questions: arrayMove(cat.questions, from, to) }
    onChange({ ...form, categories: cats })
    if (editQIdx === from) setEditQIdx(to)
    else if (editQIdx === to) setEditQIdx(from)
  }

  const switchCategory = (i: number) => { setActiveCatIdx(i); setEditQIdx(null); setNewQText('') }

  return (
    <div className="flex gap-6 max-w-5xl">
      <div className="w-52 shrink-0 space-y-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categories</p>
        {form.categories.map((c, i) => (
          <button key={i} onClick={() => switchCategory(i)}
            className={cn('w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
              i === activeCatIdx ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-600 hover:bg-slate-100')}>
            <div className="truncate">{c.category_name}</div>
            <div className="text-xs text-slate-400">{c.questions?.length ?? 0} questions</div>
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{cat?.category_name}</h3>
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
                    {cat.questions.map((q, qi) => (
                      <SortableQuestionRow
                        key={`q-${qi}`} q={q} qi={qi} catIdx={activeCatIdx}
                        form={form} onChange={onChange}
                        allQuestions={allQuestions}
                        isEditing={editQIdx === qi}
                        onStartEdit={setEditQIdx}
                        onCancelEdit={() => setEditQIdx(null)}
                      />
                    ))}
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
