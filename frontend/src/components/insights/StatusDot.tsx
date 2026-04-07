import { cn } from '@/lib/utils'
import { getThresholdStatus } from '@/constants/kpiDefs'
import type { KpiDef } from '@/constants/kpiDefs'

interface StatusDotProps {
  value: number
  thresholds: Pick<KpiDef, 'direction' | 'goal' | 'warn' | 'crit'>
  className?: string
}

const STATUS_COLORS: Record<string, string> = {
  good:     'bg-emerald-500',
  warning:  'bg-orange-400',
  critical: 'bg-red-500',
  neutral:  'bg-slate-300',
}

export default function StatusDot({ value, thresholds, className }: StatusDotProps) {
  const status = getThresholdStatus(value, thresholds)
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        STATUS_COLORS[status],
        className,
      )}
    />
  )
}
