import { cn } from '@/lib/utils'

interface StatRowProps {
  label: string
  value: string
  valueColor?: string
}

export default function StatRow({ label, value, valueColor }: StatRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cn('text-xs font-semibold text-slate-800', valueColor)}>{value}</span>
    </div>
  )
}
