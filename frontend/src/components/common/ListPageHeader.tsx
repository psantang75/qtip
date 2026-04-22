import { cn } from '@/lib/utils'

interface ListPageHeaderProps {
  title: string
  subtitle?: string
  /** Optional inline element (e.g. a status pill) shown beside the title. */
  headerBadge?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function ListPageHeader({
  title,
  subtitle,
  headerBadge,
  actions,
  className,
}: ListPageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {headerBadge}
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {actions}
        </div>
      )}
    </div>
  )
}
