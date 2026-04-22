import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import KpiInfoCard from './KpiInfoCard'

interface InsightsSectionProps {
  title: string
  description?: string
  /**
   * KPI codes whose `KpiInfoCard` should be rendered inside the info popover (description,
   * formula, source, thresholds — read live from `ie_kpi` via /insights/kpi-config). When
   * omitted, no info icon is rendered. There is no hardcoded-string fallback by design — all
   * tooltip content must come from the KPI registry so it can be edited in one place.
   */
  infoKpiCodes?: string[]
  children: React.ReactNode
  className?: string
}

export default function InsightsSection({
  title,
  description,
  infoKpiCodes,
  children,
  className,
}: InsightsSectionProps) {
  const hasInfo = !!(infoKpiCodes && infoKpiCodes.length > 0)

  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl p-5 mb-4', className)}>
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {hasInfo && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`About ${title}`}
                  className="text-slate-400 hover:text-primary transition-colors focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                className="w-96 max-h-[70vh] overflow-y-auto"
              >
                <div className="space-y-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    {infoKpiCodes!.length === 1 ? 'KPI used in this section' : 'KPIs used in this section'}
                  </p>
                  {infoKpiCodes!.map((code) => (
                    <div key={code} className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2.5">
                      <KpiInfoCard kpiCode={code} />
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}
