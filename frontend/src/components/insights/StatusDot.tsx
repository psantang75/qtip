import { cn } from '@/lib/utils'
import { getThresholdStatus } from '@/constants/kpiDefs'
import type { KpiDef } from '@/constants/kpiDefs'
import { THRESHOLD_BG } from './thresholdColors'

interface StatusDotProps {
  value: number
  thresholds: Pick<KpiDef, 'direction' | 'goal' | 'warn' | 'crit'>
  className?: string
}

export default function StatusDot({ value, thresholds, className }: StatusDotProps) {
  const status = getThresholdStatus(value, thresholds)
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        THRESHOLD_BG[status],
        className,
      )}
    />
  )
}
