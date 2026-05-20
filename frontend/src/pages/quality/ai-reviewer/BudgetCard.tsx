/**
 * Monthly cost budget card — caps USD spend on AI Reviewer calls for
 * this form. Soft-warn at 80%, hard-block at 100%; over-cap submissions
 * route to a human until the UTC month rolls over.
 */

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { BudgetGauge } from './BudgetGauge'
import { useAISettingsMutation } from './useAISettingsMutation'

interface Props {
  formId: number
  initialBudget: number | null
}

function num2str(n: number | null): string {
  return n == null ? '' : String(Number(n))
}

export function BudgetCard({ formId, initialBudget }: Props) {
  const [budget, setBudget] = useState(num2str(initialBudget))
  const mut = useAISettingsMutation(formId)
  const isAdmin = useIsAdmin()

  useEffect(() => {
    setBudget(num2str(initialBudget))
  }, [initialBudget])

  const dirty = budget.trim() !== num2str(initialBudget)

  const save = () => {
    const trimmed = budget.trim()
    if (trimmed === '') {
      mut.mutate({ ai_monthly_cost_budget_usd: null })
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return
    mut.mutate({ ai_monthly_cost_budget_usd: Math.round(n * 100) / 100 })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Monthly cost budget</h2>
          <p className="text-[12px] text-slate-500">
            Cap monthly USD spend on AI Reviewer calls. Soft-warn at 80%, hard-block at 100%. Blank = no cap.
          </p>
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={!isAdmin || !dirty || mut.isPending}
          title={!isAdmin ? 'Admin only' : undefined}
          className="bg-primary hover:bg-primary/90 text-white"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {mut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="p-4 space-y-2 max-w-md">
        <div>
          <Label htmlFor="budget" className="text-[12px] text-slate-700">
            Monthly cap (USD)
            <span className="ml-2 text-[11px] font-normal text-slate-400">(blank = unlimited)</span>
          </Label>
          <Input
            id="budget"
            type="number"
            min={0}
            step={1}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={!isAdmin}
            placeholder="e.g. 50"
            className="max-w-[160px]"
          />
        </div>
        <BudgetGauge formId={formId} />
      </div>
    </section>
  )
}
