import type { FormQuestionCondition } from '@/types/form.types'
import type { AllQuestionRef } from './questionCardTypes'

const CONDITION_LABELS: Record<string, string> = {
  EQUALS: 'equals',
  NOT_EQUALS: 'does not equal',
  EXISTS: 'has any answer',
  NOT_EXISTS: 'has no answer',
}

function resolveValueLabel(
  targetQ: AllQuestionRef | undefined,
  value: string | undefined,
): string {
  if (!value || !targetQ) return value ?? ''
  if (targetQ.type === 'YES_NO') return value === 'YES' ? 'Yes' : value === 'NO' ? 'No' : value
  if (targetQ.type === 'RADIO') {
    const opt = targetQ.radioOptions.find(o => o.option_value === value)
    return opt ? opt.option_text : value
  }
  return value
}

function formatOneCondition(
  cond: FormQuestionCondition,
  allQuestions: AllQuestionRef[],
): string {
  const targetQ = allQuestions.find(q => q.id === cond.target_question_id)
  const qLabel = targetQ
    ? `${targetQ.text.substring(0, 50)}${targetQ.text.length > 50 ? '…' : ''}`
    : 'Unknown question'
  const op = CONDITION_LABELS[cond.condition_type] ?? cond.condition_type
  const needsValue = cond.condition_type === 'EQUALS' || cond.condition_type === 'NOT_EQUALS'
  const val = needsValue ? ` "${resolveValueLabel(targetQ, cond.target_value ?? '')}"` : ''
  return `IF "${qLabel}" ${op}${val}`
}

export function conditionSummaryText(
  conditions: FormQuestionCondition[],
  allQuestions: AllQuestionRef[],
): string {
  if (!conditions.length) return ''
  return conditions.map(c => formatOneCondition(c, allQuestions)).join('; ')
}

export function ConditionSummary({
  conditions,
  allQuestions,
}: {
  conditions: FormQuestionCondition[]
  allQuestions: AllQuestionRef[]
}) {
  if (!conditions.length) return null

  const byGroup: Record<number, FormQuestionCondition[]> = {}
  conditions.forEach(c => {
    const g = c.group_id ?? 0
    if (!byGroup[g]) byGroup[g] = []
    byGroup[g].push(c)
  })
  const groups = Object.values(byGroup)

  return (
    <div className="text-[11px] text-primary/80 space-y-0.5">
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <p className="text-[10px] font-bold text-slate-500 my-0.5">OR</p>}
          {group.map((cond, ci) => (
            <div key={ci}>
              {ci > 0 && <span className="text-[10px] font-bold text-primary/60 mr-1">AND </span>}
              <span>{formatOneCondition(cond, allQuestions)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
