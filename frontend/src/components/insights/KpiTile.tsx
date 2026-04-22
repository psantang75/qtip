import { useState } from 'react'
import { FilterX, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getKpiDef,
  getKpiScope,
  formatKpiValue,
  getThresholdStatus,
} from '@/constants/kpiDefs'
import type { KpiDef } from '@/constants/kpiDefs'
import { THRESHOLD_BG } from './thresholdColors'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import KpiInfoCard from './KpiInfoCard'
import { useKpiConfig } from '@/hooks/useKpiConfig'

export interface KpiFilterContext {
  /** A department filter is currently applied on the page. */
  dept?: boolean
  /** A user/agent filter is currently applied on the page. */
  user?: boolean
  /** A form filter is currently applied on the page. */
  form?: boolean
}

interface KpiTileProps {
  kpiCode: string
  value: number | null
  priorValue?: number
  small?: boolean
  onClick?: () => void
  thresholds?: Pick<KpiDef, 'goal' | 'warn' | 'crit' | 'direction'>
  /**
   * Active dashboard filters. When a filter is active and this KPI's scope is
   * 'non_filtered' or 'mixed', a small icon appears next to the KPI name to
   * disclose that the value does not change with the current filter.
   */
  filterContext?: KpiFilterContext
}

export default function KpiTile({
  kpiCode,
  value,
  priorValue,
  small = false,
  onClick,
  thresholds: thresholdsProp,
  filterContext,
}: KpiTileProps) {
  const def = getKpiDef(kpiCode)
  const name   = def?.name   ?? kpiCode
  const format = def?.format ?? 'NUMBER'
  const scope  = getKpiScope(kpiCode)

  // Pull `decimal_places` from ie_kpi (cached, shared query). Falls back to
  // 1 decimal for PERCENT and 0 for NUMBER so existing tiles render unchanged
  // until an admin tunes the value in the KPI settings page.
  const { data: liveConfig } = useKpiConfig()
  const decimals = liveConfig?.[kpiCode]?.decimal_places
    ?? (format === 'PERCENT' ? 1 : 0)

  const [infoOpen, setInfoOpen] = useState(false)

  // Prefer live IE thresholds from the prop; fall back to static kpiDefs
  const thresholds: Pick<KpiDef, 'goal' | 'warn' | 'crit' | 'direction'> =
    thresholdsProp ?? {
      goal:      def?.goal,
      warn:      def?.warn,
      crit:      def?.crit,
      direction: def?.direction ?? 'NEUTRAL',
    }

  const direction = thresholds.direction ?? def?.direction ?? 'NEUTRAL'

  const status = value !== null && value !== undefined
    ? getThresholdStatus(value, thresholds)
    : 'neutral'

  // Delta calculation (skipped entirely when value is suppressed)
  let deltaEl: React.ReactNode = null
  if (priorValue !== undefined && value !== null && value !== undefined) {
    const delta = value - priorValue
    if (delta === 0) {
      deltaEl = <span className="text-[10px] text-slate-400">— flat</span>
    } else {
      const isPositive = delta > 0
      const isGood =
        direction === 'UP_IS_GOOD'   ? isPositive :
        direction === 'DOWN_IS_GOOD' ? !isPositive :
        null

      const color =
        isGood === true  ? 'text-emerald-600' :
        isGood === false ? 'text-red-500'     :
        'text-slate-500'

      const arrow = isPositive ? '▲' : '▼'
      deltaEl = (
        <span className={cn('text-[10px] font-medium', color)}>
          {arrow} {Math.abs(delta).toFixed(1)}{format === 'PERCENT' ? '%' : ''}
        </span>
      )
    }
  }

  const goalDisplay = thresholds.goal != null
    ? `Goal: ${format === 'PERCENT' ? `${thresholds.goal}%` : thresholds.goal}`
    : null

  const isClickable = typeof onClick === 'function'

  // When a filter is active AND this KPI ignores it (or only partially honors it),
  // showing the value is misleading — suppress it and surface the Non-Filtered icon instead.
  const filterActive = !!(filterContext?.dept || filterContext?.user || filterContext?.form)
  const showNonFilteredIcon = filterActive && (scope === 'non_filtered' || scope === 'mixed')
  const suppressValue       = showNonFilteredIcon

  // Stop tile click from firing when interacting with the (i) button or icons
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation()

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={isClickable ? (e) => e.key === 'Enter' && onClick?.() : undefined}
      className={cn(
        'bg-white border rounded-xl transition-all',
        small ? 'p-3' : 'p-4',
        isClickable
          ? 'cursor-pointer border-slate-200 hover:border-primary hover:shadow-md hover:shadow-primary/10'
          : 'border-slate-200',
      )}
    >
      {/* Header row: name (+ optional non-filtered icon) + status dot + (i) info button */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className={cn(
            'font-medium text-slate-600 leading-tight truncate',
            small ? 'text-[11px]' : 'text-xs',
          )}>
            {name}
          </span>

          {showNonFilteredIcon && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    onClick={stop}
                    className="inline-flex items-center text-slate-400 shrink-0"
                    aria-label="KPI does not apply to current filter"
                  >
                    <FilterX className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-xs leading-snug">
                  This metric is only calculated across all departments and forms.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            'inline-block rounded-full',
            small ? 'w-1.5 h-1.5' : 'w-2 h-2',
            'mt-0.5',
            THRESHOLD_BG[suppressValue ? 'neutral' : status],
          )} />

          <Popover open={infoOpen} onOpenChange={setInfoOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(e) => { stop(e); setInfoOpen(o => !o) }}
                onKeyDown={stop}
                aria-label={`More info about ${name}`}
                className="text-slate-400 hover:text-primary transition-colors"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              className="w-96"
              onClick={stop}
            >
              <KpiInfoCard kpiCode={kpiCode} displayName={name} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Main value (dashed out when a filter would make this KPI misleading) */}
      <div className={cn(
        'font-bold leading-none',
        suppressValue ? 'text-slate-300' : 'text-slate-900',
        small ? 'text-xl' : 'text-2xl',
      )}>
        {suppressValue ? '—' : formatKpiValue(value, format, decimals)}
      </div>

      {/* Goal (or suppression caption) — always reserve the line height so delta stays aligned */}
      {!small && (
        <div className="mt-1 text-[10px] text-slate-400">
          {suppressValue
            ? <span className="italic">KPI does not apply to current filter.</span>
            : (goalDisplay ?? '\u00A0')}
        </div>
      )}

      {/* Delta + label */}
      {!suppressValue && deltaEl && (
        <div className="mt-1.5 flex items-center gap-1">
          {deltaEl}
          <span className="text-[10px] text-slate-400">vs prior period</span>
        </div>
      )}
    </div>
  )
}
