import { FileText } from 'lucide-react'
import { TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { LucideProps } from 'lucide-react'

interface TableEmptyStateProps {
  colSpan: number
  icon?: React.ComponentType<LucideProps>
  title?: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function TableEmptyState({
  colSpan,
  icon: Icon = FileText,
  title = 'No results found.',
  description,
  action,
}: TableEmptyStateProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center py-14 text-slate-400">
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
      </TableCell>
    </TableRow>
  )
}
