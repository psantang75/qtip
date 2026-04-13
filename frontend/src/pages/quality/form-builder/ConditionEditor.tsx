import React from 'react'
import { Plus } from 'lucide-react'
import type { FormQuestionCondition, ConditionType } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { AllQuestionRef } from './questionCardTypes'

export function ConditionEditor({ lGroups, setLGroups, categoryQuestions, needsValue }: {
  lGroups: FormQuestionCondition[][]
  setLGroups: React.Dispatch<React.SetStateAction<FormQuestionCondition[][]>>
  categoryQuestions: AllQuestionRef[]
  needsValue: (ct: ConditionType) => boolean
}) {
  const eligibleQuestions = categoryQuestions
    .filter(q => ['YES_NO', 'SCALE', 'RADIO'].includes(q.type))

  return (
    <div className="border border-slate-300 bg-slate-50 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Conditions (this category)</p>
        <p className="text-[10px] text-slate-400">AND within groups · OR between groups</p>
      </div>

      {lGroups.map((group, gIdx) => (
        <ConditionGroup
          key={gIdx}
          group={group}
          gIdx={gIdx}
          totalGroups={lGroups.length}
          eligibleQuestions={eligibleQuestions}
          categoryQuestions={categoryQuestions}
          setLGroups={setLGroups}
          needsValue={needsValue}
        />
      ))}

      <Button variant="ghost" size="sm" className="h-7 text-xs w-full border border-dashed border-slate-300 text-slate-500 hover:border-primary hover:text-primary rounded-lg"
        onClick={() => setLGroups(prev => [...prev, [{ target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: prev.length, sort_order: 0 }]])}>
        <Plus className="h-3 w-3 mr-1" /> Add OR Group
      </Button>
    </div>
  )
}

function ConditionGroup({ group, gIdx, totalGroups, eligibleQuestions, categoryQuestions, setLGroups, needsValue }: {
  group: FormQuestionCondition[]
  gIdx: number
  totalGroups: number
  eligibleQuestions: AllQuestionRef[]
  categoryQuestions: AllQuestionRef[]
  setLGroups: React.Dispatch<React.SetStateAction<FormQuestionCondition[][]>>
  needsValue: (ct: ConditionType) => boolean
}) {
  return (
    <div>
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
            {totalGroups > 1 ? `Group ${gIdx + 1} — ALL must match` : 'ALL must match'}
          </span>
          {totalGroups > 1 && (
            <button onClick={() => setLGroups(prev => prev.filter((_, i) => i !== gIdx))}
              className="text-[10px] text-red-400 hover:text-red-600">Remove group</button>
          )}
        </div>

        {group.map((cond, ci) => {
          const selectedQ = categoryQuestions.find(q => q.id === cond.target_question_id)
          const valueOptions = buildValueOptions(selectedQ)

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
              <div className="grid grid-cols-[1fr_140px_1fr_28px] gap-2 items-center">
                <div>
                  <Select
                    value={cond.target_question_id ? String(cond.target_question_id) : ''}
                    onValueChange={v => updateCond({ target_question_id: v ? Number(v) : 0, target_value: '' })}>
                    <SelectTrigger className="h-8 text-xs" title={selectedQ?.text}>
                      <SelectValue placeholder="Select question…" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[480px]">
                      {eligibleQuestions.map(eq => (
                        <SelectItem key={eq.id} value={String(eq.id)} className="text-xs py-2">
                          {eq.text}
                        </SelectItem>
                      ))}
                      {eligibleQuestions.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-400">No eligible questions in this category</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Select value={cond.condition_type} onValueChange={v => updateCond({ condition_type: v as ConditionType })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EQUALS">Equals</SelectItem>
                      <SelectItem value="NOT_EQUALS">Not Equals</SelectItem>
                      <SelectItem value="EXISTS">Has any answer</SelectItem>
                      <SelectItem value="NOT_EXISTS">Has no answer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  {needsValue(cond.condition_type) ? (
                    valueOptions.length > 0 ? (
                      <Select value={cond.target_value ?? ''} onValueChange={v => updateCond({ target_value: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select value…" /></SelectTrigger>
                        <SelectContent>
                          {valueOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="h-8 flex items-center">
                        <span className="text-[11px] text-slate-400 italic pl-1">
                          {cond.target_question_id ? 'No options available' : 'Select a question first'}
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="h-8 flex items-center">
                      <span className="text-[11px] text-slate-400 italic pl-1">no value needed</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-center">
                  {group.length > 1 && (
                    <button
                      onClick={() => setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g : g.filter((_, ci2) => ci2 !== ci)))}
                      className="text-red-400 hover:text-red-600 font-bold leading-none text-base">&times;</button>
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
  )
}

function buildValueOptions(selectedQ: AllQuestionRef | undefined): { label: string; value: string }[] {
  if (!selectedQ) return []
  if (selectedQ.type === 'YES_NO') {
    return [
      { label: 'Yes', value: 'YES' },
      { label: 'No', value: 'NO' },
      ...(selectedQ.naAllowed ? [{ label: 'N/A', value: 'N/A' }] : []),
    ]
  }
  if (selectedQ.type === 'SCALE') {
    return Array.from({ length: selectedQ.scaleMax - selectedQ.scaleMin + 1 }, (_, i) => {
      const v = String(selectedQ.scaleMin + i)
      return { label: v, value: v }
    })
  }
  if (selectedQ.type === 'RADIO') {
    return selectedQ.radioOptions.map(o => ({ label: o.option_text, value: o.option_value }))
  }
  return []
}
