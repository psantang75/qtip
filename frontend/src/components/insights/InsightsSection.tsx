import { cn } from '@/lib/utils'

interface InsightsSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export default function InsightsSection({ title, description, children, className }: InsightsSectionProps) {
  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl p-5 mb-4', className)}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}
