export type ThresholdStatus = 'good' | 'warning' | 'critical' | 'neutral'

export const THRESHOLD_BG: Record<ThresholdStatus, string> = {
  good:     'bg-emerald-500',
  warning:  'bg-orange-400',
  critical: 'bg-red-500',
  neutral:  'bg-slate-300',
}
