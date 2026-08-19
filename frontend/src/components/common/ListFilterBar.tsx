import { Search, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CLIENT_FETCH_LIMIT } from '@/constants/labels'

export interface SelectFilterConfig {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: string
  options: { value: string; label: string }[]
}

interface ListFilterBarProps {
  search?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  selects?: SelectFilterConfig[]
  hasFilters: boolean
  onReset: () => void
  /**
   * When provided, shows an inline "X results" chip next to Reset Filters.
   * Pass { filtered, total } for client-side pages ("12 of 48")
   * or just { total } for server-side pages ("48 results").
   */
  resultCount?: { filtered?: number; total: number }
  /**
   * When true, shows a banner explaining the list is capped at
   * `CLIENT_FETCH_LIMIT` rows. Pages set this when the server returned the full
   * cap (`items.length >= CLIENT_FETCH_LIMIT`), i.e. the date range likely holds
   * more rows than were fetched.
   */
  truncated?: boolean
  /** Slot for extra controls (date pickers, etc.) inserted after the selects */
  children?: React.ReactNode
}

export function ListFilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  selects = [],
  hasFilters,
  onReset,
  resultCount,
  truncated,
  children,
}: ListFilterBarProps) {
  const showCount = resultCount != null
  const countLabel = showCount
    ? resultCount.filtered != null
      ? `${resultCount.filtered.toLocaleString()} of ${resultCount.total.toLocaleString()}`
      : `${resultCount.total.toLocaleString()}`
    : null

  return (
    <div className="space-y-0">
    {truncated && (
      <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        Showing the first {CLIENT_FETCH_LIMIT.toLocaleString()} records — narrow your date range to see the rest.
      </div>
    )}
    <div className={`bg-white ${truncated ? 'rounded-b-xl border-t-0' : 'rounded-xl'} border border-slate-200 p-4 flex flex-wrap items-center gap-3`}>
      {onSearchChange && (
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={search ?? ''}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-10"
          />
        </div>
      )}

      {selects.map(f => (
        <Select key={f.id} value={f.value} onValueChange={f.onChange}>
          <SelectTrigger className={f.width ?? 'w-[145px]'}>
            <SelectValue placeholder={f.placeholder ?? 'Filter…'} />
          </SelectTrigger>
          <SelectContent>
            {f.options.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {children}

      {/* Spacer + result count + reset */}
      <div className="ml-auto flex items-center gap-3">
        {showCount && countLabel && (
          <span className="text-[12px] text-slate-500">
            <span className="font-semibold text-slate-700">{countLabel}</span> results
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!hasFilters}
          className="h-7 px-2 text-[12px] text-primary hover:text-primary hover:bg-primary/5"
        >
          Reset Filters
        </Button>
      </div>
    </div>
    </div>
  )
}
