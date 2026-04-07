import { cn } from '@/lib/utils'

type BadgeVariant = 'good' | 'bad' | 'warning' | 'neutral'

interface StatusBadgeProps {
  label: string
  variant?: BadgeVariant
  className?: string
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  good:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  bad:     'bg-red-50 text-red-600 border border-red-200',
  warning: 'bg-orange-50 text-orange-600 border border-orange-200',
  neutral: 'bg-slate-100 text-slate-600 border border-slate-200',
}

const AUTO_DETECT: Record<string, BadgeVariant> = {
  closed:    'good',
  completed: 'good',
  passed:    'good',
  active:    'good',
  first:     'good',
  open:      'neutral',
  pending:   'neutral',
  scheduled: 'neutral',
  'in progress': 'neutral',
  'follow-up':   'warning',
  'follow up':   'warning',
  overdue:   'bad',
  'at risk': 'bad',
  repeat:    'bad',
  failed:    'bad',
  disputed:  'bad',
  escalated: 'bad',
}

function detectVariant(label: string): BadgeVariant {
  return AUTO_DETECT[label.toLowerCase()] ?? 'neutral'
}

export default function StatusBadge({ label, variant, className }: StatusBadgeProps) {
  const resolved = variant ?? detectVariant(label)
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium',
        VARIANT_CLASSES[resolved],
        className,
      )}
    >
      {label}
    </span>
  )
}
