/**
 * BudgetGauge
 *
 * Two presentations of the same data point — month-to-date AI Reviewer
 * spend vs. the form's configured monthly budget:
 *
 *   - <BudgetGauge /> renders the inline "$X.XX of $Y.YY" gauge inside
 *     the settings card next to the budget input.
 *   - <BudgetChip /> renders the compact page-header pill (matches the
 *     visual language of ReadinessChip and DriftBadge).
 *
 * Color states:
 *   - No budget configured  -> gauge hidden, chip hidden.
 *   - <80%                  -> green bar / green chip.
 *   - 80% - <100%           -> amber.
 *   - >=100%                -> red. Chip + gauge both flip and we surface
 *                              a tooltip explaining that new submissions
 *                              are routed to humans.
 */

import { useQuery } from '@tanstack/react-query'
import { DollarSign, AlertOctagon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import aiReviewerService from '@/services/aiReviewerService'

interface Props {
  formId: number
}

function ratioOf(mtd: number, budget: number | null): number | null {
  if (budget == null || budget <= 0) return null
  return mtd / budget
}

function colorFor(ratio: number | null): { bar: string; chip: string; text: string } {
  if (ratio == null) return { bar: 'bg-slate-200', chip: 'text-slate-700 bg-slate-50 border-slate-200', text: 'text-slate-600' }
  if (ratio >= 1) return { bar: 'bg-rose-500', chip: 'text-rose-700 bg-rose-50 border-rose-200', text: 'text-rose-700' }
  if (ratio >= 0.8) return { bar: 'bg-amber-500', chip: 'text-amber-700 bg-amber-50 border-amber-200', text: 'text-amber-700' }
  return { bar: 'bg-emerald-500', chip: 'text-emerald-700 bg-emerald-50 border-emerald-200', text: 'text-emerald-700' }
}

function fmt(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function BudgetGauge({ formId }: Props) {
  const q = useQuery({
    queryKey: ['ai-reviewer-cost', formId],
    queryFn: () => aiReviewerService.getCostStatus(formId),
    staleTime: 60 * 1000,
    enabled: Number.isFinite(formId) && formId > 0,
  })

  const status = q.data
  if (!status) return null
  if (status.budgetUsd == null) {
    return (
      <p className="text-[11px] text-slate-500 mt-1">
        Month-to-date AI cost: <span className="font-mono">{fmt(status.mtdUsd)}</span>{' '}
        <span className="text-slate-400">(no budget set)</span>
      </p>
    )
  }
  const ratio = ratioOf(status.mtdUsd, status.budgetUsd)
  const pct = Math.min(100, Math.max(0, (ratio ?? 0) * 100))
  const colors = colorFor(ratio)
  return (
    <div className="mt-2 max-w-md">
      <div className="flex items-center justify-between text-[11px]">
        <span className={colors.text}>
          MTD <span className="font-mono">{fmt(status.mtdUsd)}</span> of{' '}
          <span className="font-mono">{fmt(status.budgetUsd)}</span>
        </span>
        <span className="text-slate-400">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${colors.bar}`} style={{ width: `${pct}%` }} />
      </div>
      {ratio != null && ratio >= 0.8 && (
        <p className={`text-[11px] mt-1 ${colors.text}`}>
          {ratio >= 1
            ? 'Budget exhausted — new submissions are being routed to a human reviewer until the next UTC month.'
            : 'Approaching budget. New submissions still run, but consider lowering form usage or raising the cap.'}
        </p>
      )}
    </div>
  )
}

export function BudgetChip({ formId }: Props) {
  const q = useQuery({
    queryKey: ['ai-reviewer-cost', formId],
    queryFn: () => aiReviewerService.getCostStatus(formId),
    staleTime: 60 * 1000,
    enabled: Number.isFinite(formId) && formId > 0,
  })

  const status = q.data
  if (!status || status.budgetUsd == null) return null
  const ratio = ratioOf(status.mtdUsd, status.budgetUsd)
  const colors = colorFor(ratio)
  const pct = Math.round((ratio ?? 0) * 100)
  const exhausted = ratio != null && ratio >= 1
  const label = exhausted ? 'Budget hit' : `Budget ${pct}%`
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ' +
              colors.chip
            }
          >
            {exhausted ? <AlertOctagon className="h-3 w-3" /> : <DollarSign className="h-3 w-3" />}
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-[11px] leading-snug">
          {status.reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
