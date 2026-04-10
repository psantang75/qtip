import { cn } from '@/lib/utils'

type Direction = 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL'

interface StatRowProps {
  label: string
  value: string
  valueColor?: string
  trend?: {
    current: number | null
    prior: number | null
    direction?: Direction
    suffix?: string
  }
  thresholds?: {
    goal: number | null
    warn: number | null
    crit: number | null
    direction: string
    suffix?: string
  }
}

function resolveValueColor(
  current: number | null,
  th: StatRowProps['thresholds'],
): string | undefined {
  if (!th || current == null || th.goal == null) return undefined
  const dir = th.direction
  if (dir === 'UP_IS_GOOD') {
    if (current >= th.goal) return 'text-emerald-600'
    if (th.warn != null && current >= th.warn) return 'text-orange-500'
    return 'text-red-600'
  }
  if (dir === 'DOWN_IS_GOOD') {
    if (current <= th.goal) return 'text-emerald-600'
    if (th.warn != null && current <= th.warn) return 'text-orange-500'
    return 'text-red-600'
  }
  return undefined
}

export default function StatRow({ label, value, valueColor, trend, thresholds }: StatRowProps) {
  const autoColor = thresholds ? resolveValueColor(trend?.current ?? null, thresholds) : undefined
  const finalColor = valueColor ?? autoColor
  const hasCols = !!(trend || thresholds)

  let trendText = ''
  let trendColor = 'text-slate-400'
  if (trend && trend.current != null && trend.prior != null) {
    const delta = trend.current - trend.prior
    if (delta === 0) {
      trendText = '— flat'
    } else {
      const isPositive = delta > 0
      const dir = trend.direction ?? 'NEUTRAL'
      const isGood = dir === 'UP_IS_GOOD' ? isPositive : dir === 'DOWN_IS_GOOD' ? !isPositive : null
      trendColor = isGood === true ? 'text-emerald-600' : isGood === false ? 'text-red-500' : 'text-slate-500'
      const arrow = isPositive ? '▲' : '▼'
      const suffix = trend.suffix ?? ''
      trendText = `${arrow} ${Math.abs(delta).toFixed(1)}${suffix}`
    }
  }

  const goalText = thresholds?.goal != null
    ? `Goal: ${thresholds.goal}${thresholds.suffix ?? ''}`
    : ''

  if (!hasCols) {
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={cn('text-xs font-semibold text-slate-800', finalColor)}>{value}</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[1fr_5rem_5.5rem_6rem] items-center py-2.5 border-b border-slate-100 last:border-0 gap-x-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cn('text-xs font-semibold text-right', finalColor ?? 'text-slate-800')}>{value}</span>
      <span className={cn('text-[10px] font-medium text-right', trendColor)}>{trendText || '—'}</span>
      <span className="text-[10px] text-slate-400 text-right">{goalText}</span>
    </div>
  )
}
