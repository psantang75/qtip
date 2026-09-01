import React from 'react'
import { CheckCircle2, Plus, GripVertical } from 'lucide-react'
import type { FormQuestionCondition, FormQuestionRole, FormRollupRule, RadioOption, QuestionType, ConditionType } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
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
  lCritical: boolean
  lRole: FormQuestionRole
  lRollupRule: FormRollupRule
  lRollupMembers: number[]
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
  setLCritical: (v: boolean) => void
  setLRole: (v: FormQuestionRole) => void
  setLRollupRule: (v: FormRollupRule) => void
  setLRollupMembers: (v: number[]) => void
  setErr: (v: string | null) => void
  addOpt: () => void; saveEdit: () => void; onCancelEdit: () => void
}

export function QuestionEditPanel({ qi, state, actions, allQuestions, categoryQuestions, gateIds, currentQuestionId }: {
  qi: number
  state: EditState; actions: EditActions
  /**
   * Every question in the form (form-wide). Feeds the Conditional Logic
   * editor so a question can gate on any other question, including an
   * initial "interaction type" gate that lives in a different category.
   */
  allQuestions: AllQuestionRef[]
  /**
   * Questions that live in the SAME category as the one being edited.
   * Used by the Roll-up member picker so authors only pick from questions
   * visually next to this one (roll-ups stay category-scoped by design).
   */
  categoryQuestions: AllQuestionRef[]
  /** Question IDs referenced as a gate by another question's condition. */
  gateIds: Set<number>
  /** Numeric ID of the question being edited (so members/conditions can't include self). */
  currentQuestionId: number | undefined
}) {
  const { lText, lType, lRequired, lVisible, lNa, lYes, lNo, lNaVal, lScaleMin, lScaleMax, lRadio, newOptText, newOptScore, lCond, lGroups, lCritical, lRole, lRollupRule, lRollupMembers, err } = state
  const { setLText, setLType, setLRequired, setLVisible, setLNa, setLYes, setLNo, setLNaVal, setLScaleMin, setLScaleMax, setLRadio, setNewOptText, setNewOptScore, setLCond, setLGroups, setLCritical, setLRole, setLRollupRule, setLRollupMembers, setErr, addOpt, saveEdit, onCancelEdit } = actions

  const noPoints  = lType === 'INFO_BLOCK' || lType === 'TEXT' || lType === 'SUB_CATEGORY'
  const hasOptions = lType === 'RADIO' || lType === 'MULTI_SELECT'
  // Critical fail only triggers the cap when an answer is "no"/"false", which is
  // unambiguous on Yes/No questions. Allowing it on Radio / Multi-Select would let
  // managers flag a question that the scoring engine can never actually fail.
  const criticalSupported = lType === 'YES_NO'
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
          <Checkbox id={`na-${qi}`} checked={lNa} onCheckedChange={c => setLNa(c === true)} className="h-3.5 w-3.5" />
          <label htmlFor={`na-${qi}`} className="text-xs text-slate-700 cursor-pointer">Allow N/A answer</label>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Checkbox id={`cond-${qi}`} checked={lCond} onCheckedChange={c => setLCond(c === true)} className="h-3.5 w-3.5" />
          <label htmlFor={`cond-${qi}`} className="text-xs font-medium text-slate-700 cursor-pointer">
            Conditional Logic — only show this question when conditions are met
          </label>
        </div>
        {lCond && <ConditionEditor lGroups={lGroups} setLGroups={setLGroups} sourceQuestions={allQuestions} currentQuestionId={currentQuestionId} needsValue={needsValue} />}
      </div>

      {lType === 'YES_NO' && (
        <RollupSection
          qi={qi}
          lRole={lRole} setLRole={setLRole}
          lRollupRule={lRollupRule} setLRollupRule={setLRollupRule}
          lRollupMembers={lRollupMembers} setLRollupMembers={setLRollupMembers}
          categoryQuestions={categoryQuestions}
          gateIds={gateIds}
          currentQuestionId={currentQuestionId}
        />
      )}

      <div className="flex flex-wrap gap-5 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-2"><Switch checked={lRequired} onCheckedChange={setLRequired} /><Label className="text-xs cursor-pointer">Required</Label></div>
        <div className="flex items-center gap-2"><Switch checked={lVisible} onCheckedChange={setLVisible} /><Label className="text-xs cursor-pointer">Visible to User</Label></div>
        <div className={`flex items-center gap-2 ${criticalSupported ? '' : 'opacity-50'}`} title={criticalSupported ? 'Triggers the form\u2019s critical-fail cap when answered No.' : 'Critical fail is only available for Yes/No questions.'}>
          <Switch checked={criticalSupported && lCritical} onCheckedChange={v => setLCritical(criticalSupported ? v : false)} disabled={!criticalSupported} />
          <Label className="text-xs cursor-pointer text-red-700">Critical fail</Label>
        </div>
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

/**
 * Roll-up authoring section. Only rendered for YES_NO questions because the
 * engine produces yes/no/na answers; making a SCALE or RADIO question into
 * a roll-up has no sensible mapping in V1.
 */
function RollupSection({
  qi, lRole, setLRole, lRollupRule, setLRollupRule,
  lRollupMembers, setLRollupMembers,
  categoryQuestions, gateIds, currentQuestionId,
}: {
  qi: number
  lRole: FormQuestionRole
  setLRole: (v: FormQuestionRole) => void
  lRollupRule: FormRollupRule
  setLRollupRule: (v: FormRollupRule) => void
  lRollupMembers: number[]
  setLRollupMembers: (v: number[]) => void
  /**
   * Restricted to the SAME category as the rollup question, so authors
   * never have to scroll through unrelated questions when picking members.
   * (Conditional Logic, by contrast, can gate on any question form-wide.)
   */
  categoryQuestions: AllQuestionRef[]
  gateIds: Set<number>
  currentQuestionId: number | undefined
}) {
  // Same segmented-pill class set used by the audit form's YesNo / Radio
  // questions (formRendererComponents.optionCls) so the builder feels
  // consistent with what reviewers see when grading.
  const pillBase = 'inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer select-none'
  const pillOn   = 'bg-primary text-white border-primary'
  const pillOff  = 'bg-white text-slate-700 border-slate-300 hover:border-primary/50'

  // Suppress `lRollupRule` unused-warning. We still store it (in case we
  // ever add additional rules) but don't expose it in the UI today.
  void lRollupRule
  void setLRollupRule

  // Picker list - SAME category, YES_NO type, not self, not another
  // roll-up. Conditional trigger questions ARE included so the author
  // sees full context (helpful in complex forms) but they're rendered
  // read-only with a "Conditional" pill instead of a checkbox so they
  // can't be picked. Authors should pick the action the conditional
  // controls, not the trigger itself.
  const memberCandidates = categoryQuestions.filter((q) => {
    if (currentQuestionId !== undefined && q.id === currentQuestionId) return false  // never self
    if (q.role === 'ROLLUP') return false  // no nested roll-ups in V1
    if (q.type !== 'YES_NO') return false  // SUB_CATEGORY/TEXT/INFO can't contribute
    return true
  })

  const toggleMember = (id: number) => {
    if (lRollupMembers.includes(id)) {
      setLRollupMembers(lRollupMembers.filter((m) => m !== id))
    } else {
      setLRollupMembers([...lRollupMembers, id])
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Label className="text-xs font-medium text-slate-700">Question role</Label>
        <div className="flex gap-1.5">
          <button type="button" id={`role-detail-${qi}`}
            className={`${pillBase} ${lRole === 'DETAIL' ? pillOn : pillOff}`}
            onClick={() => setLRole('DETAIL')}
            title="Standard graded question - the human or AI answers it directly.">
            Detail
          </button>
          <button type="button" id={`role-rollup-${qi}`}
            className={`${pillBase} ${lRole === 'ROLLUP' ? pillOn : pillOff}`}
            onClick={() => setLRole('ROLLUP')}
            title="Category summary question - the answer is computed from the sub-questions you pick below.">
            Roll-up
          </button>
        </div>
      </div>

      {lRole === 'ROLLUP' && (
        <div className="border border-primary/30 bg-primary/[0.03] rounded-lg p-3 space-y-3">
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-slate-700">How this roll-up is scored</p>
            <ul className="text-[11px] text-slate-600 leading-relaxed list-disc pl-5 space-y-0.5">
              <li><strong>YES</strong> if every applicable sub-question is YES (or N/A)</li>
              <li><strong>NO</strong> if any applicable sub-question is NO</li>
              <li><strong>N/A</strong> if no sub-questions applied to this call (e.g. all gates were NO)</li>
            </ul>
            <p className="text-[10px] text-slate-500 italic pt-1">
              "Applicable" means visible &mdash; sub-questions that are hidden by their own conditional logic are skipped automatically.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Sub-questions that feed this roll-up <span className="text-slate-400">({lRollupMembers.length} selected)</span>
            </Label>
            <p className="text-[10px] text-slate-500">
              Pick the scoreable Yes/No questions to include. Questions that trigger Conditional Logic are shown for context but can't be picked &mdash; choose the question that the conditional controls instead.
            </p>
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md bg-white divide-y divide-slate-100">
              {memberCandidates.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-slate-400 italic">
                  No eligible Yes/No questions in this category. Add some sub-questions first, then come back to set up the roll-up.
                </div>
              ) : memberCandidates.map((q) => {
                const isConditionalTrigger = gateIds.has(q.id)
                const checked = lRollupMembers.includes(q.id)
                if (isConditionalTrigger) {
                  return (
                    <div key={q.id} className="flex items-start gap-2 px-2.5 py-1.5 bg-slate-50/60">
                      <span
                        className="mt-0.5 inline-flex items-center justify-center h-3.5 px-1.5 rounded text-[8px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200"
                        title="This question controls another question via Conditional Logic, so it can't be a roll-up member. Pick the question the conditional controls instead."
                      >
                        Conditional
                      </span>
                      <span className="flex-1 min-w-0 text-xs text-slate-500 italic">{q.text || '(untitled)'}</span>
                    </div>
                  )
                }
                return (
                  <div key={q.id} className="flex items-start gap-2 px-2.5 py-1.5 hover:bg-slate-50">
                    <Checkbox
                      id={`member-${q.id}`}
                      checked={checked}
                      onCheckedChange={() => toggleMember(q.id)}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <label htmlFor={`member-${q.id}`} className="flex-1 min-w-0 text-xs text-slate-700 cursor-pointer">{q.text || '(untitled)'}</label>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
