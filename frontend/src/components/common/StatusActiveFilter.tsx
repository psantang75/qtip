import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type StatusActiveValue = 'all' | 'active' | 'inactive'

interface StatusActiveFilterProps {
  value: StatusActiveValue
  onChange: (value: StatusActiveValue) => void
  /** Label for the "all" option and trigger placeholder. Defaults to "All Status". */
  allLabel?: string
  /** Tailwind width class for the trigger. Defaults to w-[145px]. */
  widthClass?: string
}

/**
 * StatusActiveFilter — shared Active/Inactive/All select used on list pages
 * (Form Builder, Library Quizzes, Library Resources, etc).
 *
 * Centralises the trigger width, the option labels, and the value contract
 * so all three modules look and behave identically.
 */
export function StatusActiveFilter({
  value,
  onChange,
  allLabel = 'All Status',
  widthClass = 'w-[145px]',
}: StatusActiveFilterProps) {
  return (
    <Select value={value} onValueChange={v => onChange(v as StatusActiveValue)}>
      <SelectTrigger className={cn(widthClass)}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="inactive">Inactive</SelectItem>
      </SelectContent>
    </Select>
  )
}
