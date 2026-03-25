import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface ListPaginationProps {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function ListPagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}: ListPaginationProps) {
  if (totalPages <= 1 && totalItems <= pageSizeOptions[0]) return null

  const from = Math.min((page - 1) * pageSize + 1, totalItems)
  const to   = Math.min(page * pageSize, totalItems)

  return (
    <div className="flex items-center justify-between text-sm text-slate-500">
      <div className="flex items-center gap-3">
        <span className="text-[13px]">
          Showing <span className="font-medium text-slate-700">{from}–{to}</span> of{' '}
          <span className="font-medium text-slate-700">{totalItems.toLocaleString()}</span>
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-slate-400">Rows:</span>
            <Select
              value={String(pageSize)}
              onValueChange={v => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-[60px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map(s => (
                  <SelectItem key={s} value={String(s)} className="text-[12px]">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[13px] mr-1">
          Page <span className="font-medium text-slate-700">{page}</span> of{' '}
          <span className="font-medium text-slate-700">{totalPages}</span>
        </span>
        <Button
          variant="outline" size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline" size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
