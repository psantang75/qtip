import { FileText } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ComponentType<LucideProps>
  title?: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

/**
 * EmptyState — non-table variant of {@link TableEmptyState} for grid/card
 * layouts where there is no surrounding `<table>` to host a colSpan row.
 *
 * Visual treatment matches TableEmptyState so the two read identically
 * across the app.
 */
export function EmptyState({
  icon: Icon = FileText,
  title = 'No results found.',
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('text-center py-14 text-slate-400', className)}>
      <Icon className="h-8 w-8 mx-auto mb-2 text-slate-300" />
      <p className="font-medium text-slate-500">{title}</p>
      {description && (
        <p className="text-[13px] text-slate-400 mt-1">{description}</p>
      )}
      {action && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-primary"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
