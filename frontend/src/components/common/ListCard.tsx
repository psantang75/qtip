import { cn } from '@/lib/utils'

/**
 * ListCard — shared white card wrapper for table/list content inside a list page.
 *
 * Replaces the repeated `bg-white rounded-xl border border-slate-200 overflow-hidden`
 * div on every list page. One edit here updates the table-card chrome everywhere.
 */
export function ListCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 overflow-hidden', className)}>
      {children}
    </div>
  )
}
