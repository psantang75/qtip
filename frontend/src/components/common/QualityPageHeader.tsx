import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface QualityPageHeaderProps {
  title: string
  subtitle?: string
  count?: number | string
  onRefresh?: () => void
  actions?: React.ReactNode
  className?: string
}

export function QualityPageHeader({
  title,
  subtitle,
  count,
  onRefresh,
  actions,
  className,
}: QualityPageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        {actions}
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        )}
      </div>
    </div>
  )
}
