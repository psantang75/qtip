import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { SortDir } from '@/hooks/useListSort'

interface SortableTableHeadProps {
  field: string
  sort: string | null
  dir: SortDir
  onSort: (field: string) => void
  children: React.ReactNode
  right?: boolean
  className?: string
}

export function SortableTableHead({
  field,
  sort,
  dir,
  onSort,
  children,
  right = false,
  className,
}: SortableTableHeadProps) {
  const active = sort === field
  const Icon = active
    ? dir === 'asc' ? ChevronUp : ChevronDown
    : ChevronsUpDown

  const ariaSort = active
    ? (dir === 'asc' ? 'ascending' : 'descending')
    : 'none'

  return (
    <TableHead
      aria-sort={ariaSort as 'ascending' | 'descending' | 'none'}
      className={cn(
        'py-4 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap',
        right && 'text-right',
        className,
      )}
      onClick={() => onSort(field)}
    >
      <span className={cn('flex items-center gap-1', right && 'justify-end')}>
        {children}
        <Icon size={12} className={active ? 'text-primary' : 'text-slate-400'} />
      </span>
    </TableHead>
  )
}
