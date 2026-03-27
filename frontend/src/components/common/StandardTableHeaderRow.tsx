import { TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Standard header row for all data tables across the app.
 * Single source of truth for the bg-slate-50 / border-b styling.
 *
 * Usage:
 *   <TableHeader>
 *     <StandardTableHeaderRow>
 *       <TableHead>Name</TableHead>
 *       ...
 *     </StandardTableHeaderRow>
 *   </TableHeader>
 */
export function StandardTableHeaderRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <TableRow className={cn('bg-slate-50 border-b border-slate-200', className)}>
      {children}
    </TableRow>
  )
}
