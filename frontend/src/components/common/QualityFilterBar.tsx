import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export interface SelectFilterConfig {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: string
  options: { value: string; label: string }[]
}

interface QualityFilterBarProps {
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
  /** Slot for extra controls (date pickers, etc.) inserted after the selects */
  children?: React.ReactNode
}

export function QualityFilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  selects = [],
  hasFilters,
  onReset,
  resultCount,
  children,
}: QualityFilterBarProps) {
  const showCount = resultCount != null
  const countLabel = showCount
    ? resultCount.filtered != null
      ? `${resultCount.filtered.toLocaleString()} of ${resultCount.total.toLocaleString()}`
      : `${resultCount.total.toLocaleString()}`
    : null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
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
        <button
          onClick={onReset}
          disabled={!hasFilters}
          className="text-[12px] font-medium text-primary hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
        >
          Reset Filters
        </button>
      </div>
    </div>
  )
}
