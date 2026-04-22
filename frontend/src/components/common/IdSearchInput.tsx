import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface IdSearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Tailwind width class for the wrapper. Defaults to w-[150px]. */
  widthClass?: string
  /** Restrict to numeric characters only. Defaults to true. */
  numericOnly?: boolean
}

/**
 * IdSearchInput — shared "by ID" search field used in list filter bars.
 *
 * Centralises the magnifying-glass icon, dimensions, and numeric-only
 * sanitisation so every list page (Performance Warnings, Submissions,
 * Coaching Sessions, etc.) uses the exact same control.
 */
export function IdSearchInput({
  value,
  onChange,
  placeholder = 'ID #',
  widthClass = 'w-[150px]',
  numericOnly = true,
}: IdSearchInputProps) {
  return (
    <div className={cn('relative', widthClass)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      <Input
        type="text"
        inputMode={numericOnly ? 'numeric' : undefined}
        pattern={numericOnly ? '[0-9]*' : undefined}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(numericOnly ? e.target.value.replace(/\D/g, '') : e.target.value)}
        className="pl-8 h-9 text-[13px]"
      />
    </div>
  )
}
