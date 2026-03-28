import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type DateField = 'session_date' | 'due_date' | 'follow_up_date'

const DATE_FIELD_LABELS: Record<DateField, string> = {
  session_date:   'Session Date',
  due_date:       'Due Date',
  follow_up_date: 'Follow-Up Date',
}

interface DateFieldRangeFilterProps {
  field:    DateField
  start:    string
  end:      string
  onFieldChange: (field: DateField) => void
  onRangeChange: (start: string, end: string) => void
}

/**
 * A combined "apply to" selector + date range picker.
 * Lets the user choose which date column the range applies to.
 */
export function DateFieldRangeFilter({
  field, start, end, onFieldChange, onRangeChange,
}: DateFieldRangeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={field} onValueChange={v => onFieldChange(v as DateField)}>
        <SelectTrigger className="w-[155px] h-9 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(DATE_FIELD_LABELS) as [DateField, string][]).map(([val, label]) => (
            <SelectItem key={val} value={val}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-slate-500 shrink-0">From</span>
        <input
          type="date"
          value={start}
          max={end || undefined}
          onChange={e => onRangeChange(e.target.value, end)}
          className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/40 w-[140px]"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-slate-500 shrink-0">To</span>
        <input
          type="date"
          value={end}
          min={start || undefined}
          onChange={e => onRangeChange(start, e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/40 w-[140px]"
        />
      </div>
    </div>
  )
}
