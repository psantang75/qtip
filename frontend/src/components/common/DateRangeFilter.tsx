import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/Input'

export interface DateRange {
  start: string
  end: string
}

interface DateRangeFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-slate-500 shrink-0">From</span>
        <Input
          type="date"
          value={value.start}
          max={value.end || undefined}
          onChange={e => onChange({ ...value, start: e.target.value })}
          className="h-9 w-[140px]"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-slate-500 shrink-0">To</span>
        <Input
          type="date"
          value={value.end}
          min={value.start || undefined}
          onChange={e => onChange({ ...value, end: e.target.value })}
          className="h-9 w-[140px]"
        />
      </div>
    </div>
  )
}
