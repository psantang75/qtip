import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Metric explainer for the Productivity report. The explained element is itself
 * the hover trigger — never an info icon — and the card states the actual basis
 * the figure used, not just its formula. Layout mirrors `KpiInfoCard` per
 * `docs/design.md` §6.6.
 *
 * Requires a `TooltipProvider` above it.
 */
export default function MetricTooltip({ title, description, rows, children }: {
  title: string
  description: string
  rows: { label: string; value: string; dotCls?: string }[]
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[320px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <div className="text-[13px] font-semibold text-slate-900">{title}</div>
        <p className="mt-1 text-[12.5px] leading-snug text-slate-600">{description}</p>
        <div className="mt-2 space-y-1">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                {r.dotCls && <span className={cn('h-2 w-2 shrink-0 rounded-sm', r.dotCls)} />}
                {r.label}
              </span>
              <span className="text-[12px] font-medium tabular-nums text-slate-800">{r.value}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
