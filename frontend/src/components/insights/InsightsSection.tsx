import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import KpiInfoCard from './KpiInfoCard'

interface InsightsSectionProps {
  title?: string
  description?: string
  /**
   * KPI codes whose `KpiInfoCard` should be rendered inside the info popover (description,
   * formula, source, thresholds — read live from `ie_kpi` via /insights/kpi-config). When
   * omitted, no info icon is rendered. There is no hardcoded-string fallback by design — all
   * tooltip content must come from the KPI registry so it can be edited in one place.
   */
  infoKpiCodes?: string[]
  /**
   * When set, renders a muted "Data last updated: {value}" stamp on the right
   * of the section header so users always see the freshness of the data behind
   * the table/chart. Phase 2 sources this from the ingestion log per dataset.
   */
  lastUpdated?: string
  /**
   * When set with `lastUpdated`, the freshness stamp gains a hover tooltip
   * showing the ingestion cadence and the next expected refresh. Both are
   * sourced from `ie_source_report` (frequency_minutes + next_run_at) via the
   * report endpoint and rendered in the viewer's local timezone.
   */
  nextUpdate?: string
  updateEveryMinutes?: number | null
  children: React.ReactNode
  className?: string
}

/** Human cadence label: 60 -> "1h", 120 -> "2h", 1440 -> "daily". */
function formatEvery(minutes: number): string {
  if (minutes <= 0) return ''
  if (minutes === 1440) return 'daily'
  if (minutes % 1440 === 0) return `every ${minutes / 1440}d`
  if (minutes % 60 === 0) return `every ${minutes / 60}h`
  if (minutes < 60) return `every ${minutes}m`
  return `every ${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * The API ships `lastUpdated` as an ISO-8601 UTC timestamp (e.g.
 * "2026-06-19T11:42:29Z"). Render it in the viewer's local timezone so the
 * stamp matches the wall clock of whoever is looking at the page. Falls back
 * to the raw value if it isn't a parseable timestamp.
 */
function formatLastUpdatedLocal(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = d.getFullYear()
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  let hr = d.getHours() % 12
  if (hr === 0) hr = 12
  const hh = String(hr).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd}-${yyyy} ${hh}:${min} ${ampm}`
}

export default function InsightsSection({
  title,
  description,
  infoKpiCodes,
  lastUpdated,
  nextUpdate,
  updateEveryMinutes,
  children,
  className,
}: InsightsSectionProps) {
  const cadence = updateEveryMinutes ? formatEvery(updateEveryMinutes) : ''
  const nextLabel = nextUpdate ? formatLastUpdatedLocal(nextUpdate) : ''
  const hasFreshnessTip = !!(lastUpdated && (cadence || nextLabel))
  const hasInfo = !!(infoKpiCodes && infoKpiCodes.length > 0)
  const hasHeader = !!(title || description || lastUpdated)

  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl p-5 mb-4', className)}>
      {hasHeader && <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
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
        {lastUpdated && (
          hasFreshnessTip ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400 mt-0.5 cursor-help">
                    Data last updated: {formatLastUpdatedLocal(lastUpdated)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="text-[11px]">
                  {cadence && <div>Refreshes {cadence}</div>}
                  {nextLabel && <div>Next update ~{nextLabel}</div>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400 mt-0.5">
              Data last updated: {formatLastUpdatedLocal(lastUpdated)}
            </span>
          )
        )}
      </div>}
      {children}
    </div>
  )
}
