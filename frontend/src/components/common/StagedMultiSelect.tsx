import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'

interface StagedMultiSelectProps {
  /** Available options shown in the dropdown */
  options: string[]
  /** Currently applied selections */
  selected: string[]
  /** Called with the new selection when Apply is clicked */
  onApply: (values: string[]) => void
  /** Label shown when nothing is selected */
  placeholder?: string
  /** Tailwind width class for both trigger and dropdown panel */
  width?: string
}

/**
 * A multi-select dropdown that stages checkbox changes locally and only
 * applies them to the parent when the user clicks Apply.
 */
export function StagedMultiSelect({
  options,
  selected,
  onApply,
  placeholder = 'All',
  width = 'w-[200px]',
}: StagedMultiSelectProps) {
  const [open, setOpen]       = useState(false)
  const [pending, setPending] = useState<string[]>([])

  const handleOpenChange = (o: boolean) => {
    if (o) setPending(selected)
    setOpen(o)
  }

  const apply = () => {
    onApply(pending)
    setOpen(false)
  }

  const label =
    selected.length === 0 ? placeholder :
    selected.length === 1 ? selected[0] :
    `${selected.length} selected`

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`${width} justify-between font-normal text-[13px]`}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={`${width} p-0`} onCloseAutoFocus={e => e.preventDefault()}>
        <div className="max-h-[260px] overflow-y-auto py-1">
          {options.map(opt => (
            <DropdownMenuCheckboxItem
              key={opt}
              checked={pending.includes(opt)}
              onCheckedChange={checked =>
                setPending(prev => checked ? [...prev, opt] : prev.filter(x => x !== opt))
              }
              onSelect={e => e.preventDefault()}
            >
              {opt}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <div className="border-t border-slate-100 p-2 flex items-center justify-between gap-2">
          <button
            className="text-[11px] text-slate-400 hover:text-slate-600 px-1"
            onClick={() => setPending([])}
          >
            Clear
          </button>
          <Button size="sm" className="h-7 text-[12px]" onClick={apply}>
            Apply
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
