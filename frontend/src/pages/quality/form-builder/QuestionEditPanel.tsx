import React from 'react'
import { CheckCircle2, Plus, GripVertical } from 'lucide-react'
import type { FormQuestionCondition, RadioOption, QuestionType, ConditionType } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConditionEditor } from './ConditionEditor'
import type { AllQuestionRef } from './questionCardTypes'

export interface EditState {
  lText: string; lType: QuestionType
  lRequired: boolean; lVisible: boolean; lNa: boolean
  lYes: number; lNo: number; lNaVal: number
  lScaleMin: number; lScaleMax: number
  lRadio: RadioOption[]
  newOptText: string; newOptScore: number
  lCond: boolean; lGroups: FormQuestionCondition[][]
  err: string | null
}

export interface EditActions {
  setLText: (v: string) => void; setLType: (v: QuestionType) => void
  setLRequired: (v: boolean) => void; setLVisible: (v: boolean) => void
  setLNa: (v: boolean) => void; setLYes: (v: number) => void
  setLNo: (v: number) => void; setLNaVal: (v: number) => void
  setLScaleMin: (v: number) => void; setLScaleMax: (v: number) => void
  setLRadio: (v: RadioOption[]) => void
  setNewOptText: (v: string) => void
  setNewOptScore: (v: number) => void
  setLCond: (v: boolean) => void
  setLGroups: React.Dispatch<React.SetStateAction<FormQuestionCondition[][]>>
  setErr: (v: string | null) => void
  addOpt: () => void; saveEdit: () => void; onCancelEdit: () => void
}

export function QuestionEditPanel({ qi, state, actions, categoryQuestions }: {
  qi: number
  state: EditState; actions: EditActions
  categoryQuestions: AllQuestionRef[]
}) {
  const { lText, lType, lRequired, lVisible, lNa, lYes, lNo, lNaVal, lScaleMin, lScaleMax, lRadio, newOptText, newOptScore, lCond, lGroups, err } = state
  const { setLText, setLType, setLRequired, setLVisible, setLNa, setLYes, setLNo, setLNaVal, setLScaleMin, setLScaleMax, setLRadio, setNewOptText, setNewOptScore, setLCond, setLGroups, setErr, addOpt, saveEdit, onCancelEdit } = actions

  const noPoints  = lType === 'INFO_BLOCK' || lType === 'TEXT' || lType === 'SUB_CATEGORY'
  const hasOptions = lType === 'RADIO' || lType === 'MULTI_SELECT'
  const needsValue = (ct: ConditionType) => ct === 'EQUALS' || ct === 'NOT_EQUALS'

  return (
    <div className={`px-4 pb-4 pt-4 border-t rounded-b-lg space-y-4 ${lCond ? 'bg-primary/[0.03] border-t-primary/30' : 'bg-white border-t-primary/20'}`}>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{err}</div>}

      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Question Text <span className="text-red-500">*</span></Label>
          <Textarea value={lText} onChange={e => setLText(e.target.value)} rows={2} className="text-sm resize-none" autoFocus />
        </div>
        <div className="space-y-1 w-48">
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
      </div>

      {!noPoints && <PointValues lType={lType} lYes={lYes} setLYes={setLYes} lNo={lNo} setLNo={setLNo} lNa={lNa} lNaVal={lNaVal} setLNaVal={setLNaVal} lScaleMin={lScaleMin} setLScaleMin={setLScaleMin} lScaleMax={lScaleMax} setLScaleMax={setLScaleMax} hasOptions={hasOptions} />}

      {hasOptions && <OptionsList lType={lType} lRadio={lRadio} setLRadio={setLRadio} newOptText={newOptText} setNewOptText={setNewOptText} newOptScore={newOptScore} setNewOptScore={setNewOptScore} addOpt={addOpt} />}

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
        {lCond && <ConditionEditor lGroups={lGroups} setLGroups={setLGroups} categoryQuestions={categoryQuestions} needsValue={needsValue} />}
      </div>

      <div className="flex flex-wrap gap-5 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-2"><Switch checked={lRequired} onCheckedChange={setLRequired} /><Label className="text-xs cursor-pointer">Required</Label></div>
        <div className="flex items-center gap-2"><Switch checked={lVisible} onCheckedChange={setLVisible} /><Label className="text-xs cursor-pointer">Visible to User</Label></div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-white h-8 px-4" onClick={saveEdit} disabled={!lText.trim()}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save
        </Button>
        <Button variant="outline" size="sm" className="h-8 px-4" onClick={onCancelEdit}>Cancel</Button>
      </div>
    </div>
  )
}

function PointValues({ lType, lYes, setLYes, lNo, setLNo, lNa, lNaVal, setLNaVal, lScaleMin, setLScaleMin, lScaleMax, setLScaleMax, hasOptions }: {
  lType: QuestionType; lYes: number; setLYes: (v: number) => void; lNo: number; setLNo: (v: number) => void
  lNa: boolean; lNaVal: number; setLNaVal: (v: number) => void
  lScaleMin: number; setLScaleMin: (v: number) => void; lScaleMax: number; setLScaleMax: (v: number) => void; hasOptions: boolean
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-700">Point Values</p>
      {lType === 'YES_NO' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label className="text-xs text-slate-600">Yes</Label><Input type="number" min={0} step={1} value={lYes} onChange={e => setLYes(Number(e.target.value))} className="h-8 text-sm" /></div>
          <div className="space-y-1"><Label className="text-xs text-slate-600">No</Label><Input type="number" min={0} step={1} value={lNo} onChange={e => setLNo(Number(e.target.value))} className="h-8 text-sm" /></div>
          {lNa && <div className="space-y-1"><Label className="text-xs text-slate-600">N/A</Label><Input type="number" min={0} step={1} value={lNaVal} onChange={e => setLNaVal(Number(e.target.value))} className="h-8 text-sm" /></div>}
        </div>
      )}
      {lType === 'SCALE' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs text-slate-600">Min Value (points)</Label><Input type="number" value={lScaleMin} onChange={e => setLScaleMin(Number(e.target.value))} className="h-8 text-sm" /></div>
          <div className="space-y-1"><Label className="text-xs text-slate-600">Max Value (points)</Label><Input type="number" value={lScaleMax} onChange={e => setLScaleMax(Number(e.target.value))} className="h-8 text-sm" /></div>
        </div>
      )}
      {hasOptions && <p className="text-[11px] text-slate-500">{lType === 'MULTI_SELECT' ? 'Each option has its own point value. Final score = sum of all checked options.' : 'Each option has its own point value below.'}</p>}
    </div>
  )
}

function OptionsList({ lType, lRadio, setLRadio, newOptText, setNewOptText, newOptScore, setNewOptScore, addOpt }: {
  lType: QuestionType; lRadio: RadioOption[]; setLRadio: (v: RadioOption[]) => void
  newOptText: string; setNewOptText: (v: string) => void
  newOptScore: number; setNewOptScore: (v: number) => void; addOpt: () => void
}) {
  const updateOption = (idx: number, patch: Partial<RadioOption>) => {
    setLRadio(lRadio.map((o, i) => i === idx ? { ...o, ...patch } : o))
  }

  const moveOption = (from: number, to: number) => {
    if (to < 0 || to >= lRadio.length) return
    const next = [...lRadio]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setLRadio(next)
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-700">{lType === 'MULTI_SELECT' ? 'Checkbox Options' : 'Radio Options'}</p>
      <p className="text-[11px] text-slate-500">Stored answer codes (1, 2, 3…) are assigned automatically for scoring and reporting.</p>

      {lRadio.length > 0 && (
        <div className="grid grid-cols-[20px_1fr_80px_28px] gap-1.5 items-center text-[10px] text-slate-400 font-medium px-0.5">
          <div />
          <div>Label</div>
          <div>Points</div>
          <div />
        </div>
      )}

      {lRadio.map((opt, i) => (
        <div key={i} className="grid grid-cols-[20px_1fr_80px_28px] gap-1.5 items-center">
          <button className="text-slate-300 hover:text-slate-500 cursor-grab" title="Drag to reorder"
            onMouseDown={() => {}} onClick={e => { e.preventDefault(); moveOption(i, i - 1) }}>
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <Input value={opt.option_text} onChange={e => updateOption(i, { option_text: e.target.value })}
            className="h-7 text-xs" placeholder="Label" />
          <Input type="number" value={opt.score} onChange={e => updateOption(i, { score: Number(e.target.value) })}
            className="h-7 text-xs" step={1} />
          <button onClick={() => setLRadio(lRadio.filter((_, idx) => idx !== i))}
            className="text-red-400 hover:text-red-600 font-bold text-base leading-none">&times;</button>
        </div>
      ))}

      <div className="grid grid-cols-[20px_1fr_80px_28px] gap-1.5 items-center border-t border-slate-200 pt-2 mt-1">
        <div />
        <Input value={newOptText} onChange={e => setNewOptText(e.target.value)} placeholder="New label…"
          className="h-7 text-xs" onKeyDown={e => e.key === 'Enter' && addOpt()} />
        <Input type="number" value={newOptScore} onChange={e => setNewOptScore(Number(e.target.value))} placeholder="Pts"
          className="h-7 text-xs" step={1} onKeyDown={e => e.key === 'Enter' && addOpt()} />
        <Button size="sm" onClick={addOpt} className="h-7 w-7 p-0 bg-primary hover:bg-primary/90 text-white" title="Add option">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
