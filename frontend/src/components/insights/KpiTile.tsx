import { cn } from '@/lib/utils'
import {
  getKpiDef,
  formatKpiValue,
  getThresholdStatus,
} from '@/constants/kpiDefs'
import type { KpiDef } from '@/constants/kpiDefs'
import { THRESHOLD_BG } from './thresholdColors'

interface KpiTileProps {
  kpiCode: string
  value: number | null
  priorValue?: number
  small?: boolean
  onClick?: () => void
  thresholds?: Pick<KpiDef, 'goal' | 'warn' | 'crit' | 'direction'>
}

export default function KpiTile({
  kpiCode,
  value,
  priorValue,
  small = false,
  onClick,
  thresholds: thresholdsProp,
}: KpiTileProps) {
  const def = getKpiDef(kpiCode)
  const name   = def?.name   ?? kpiCode
  const format = def?.format ?? 'NUMBER'

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

  // Delta calculation
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
      {/* Header row: name + status dot */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className={cn(
          'font-medium text-slate-600 leading-tight',
          small ? 'text-[11px]' : 'text-xs',
        )}>
          {name}
        </span>
        <span className={cn(
          'inline-block rounded-full shrink-0 mt-0.5',
          small ? 'w-1.5 h-1.5' : 'w-2 h-2',
          THRESHOLD_BG[status],
        )} />
      </div>

      {/* Main value */}
      <div className={cn(
        'font-bold text-slate-900 leading-none',
        small ? 'text-xl' : 'text-2xl',
      )}>
        {formatKpiValue(value, format, format === 'NUMBER' ? 0 : 1)}
      </div>

      {/* Goal — always reserve the line height so delta stays aligned */}
      {!small && (
        <div className="mt-1 text-[10px] text-slate-400">{goalDisplay ?? '\u00A0'}</div>
      )}

      {/* Delta + label */}
      {deltaEl && (
        <div className="mt-1.5 flex items-center gap-1">
          {deltaEl}
          <span className="text-[10px] text-slate-400">vs prior period</span>
        </div>
      )}
    </div>
  )
}
