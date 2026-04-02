import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export interface GroupedOption {
  group: string   // e.g. department name — used as category header
  value: string   // the selectable value (e.g. username)
}

interface Props {
  options: GroupedOption[]
  selected: string[]
  onApply: (values: string[]) => void
  placeholder?: string
  width?: string
}

/**
 * Multi-select dropdown with grouped categories.
 * Follows the same draft/apply pattern as StagedMultiSelect, but renders
 * group headers (alphabetical) with checkboxes for each item underneath.
 */
export function GroupedStagedMultiSelect({
  options,
  selected,
  onApply,
  placeholder = 'All',
  width = 'w-[260px]',
}: Props) {
  const [open, setOpen]       = useState(false)
  const [pending, setPending] = useState<string[]>([])

  const handleOpenChange = (o: boolean) => {
    if (o) setPending(selected)
    setOpen(o)
  }

  const toggle = (value: string) =>
    setPending(prev => prev.includes(value) ? prev.filter(x => x !== value) : [...prev, value])

  const apply = () => { onApply(pending); setOpen(false) }

  // Build sorted groups: departments alpha, employees alpha within each
  const grouped = options.reduce<Record<string, string[]>>((acc, { group, value }) => {
    if (!acc[group]) acc[group] = []
    acc[group].push(value)
    return acc
  }, {})
  const sortedGroups = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
  sortedGroups.forEach(g => grouped[g].sort((a, b) => a.localeCompare(b)))

  const unGrouped = options.filter(o => !o.group).map(o => o.value).sort((a, b) => a.localeCompare(b))

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

      <DropdownMenuContent
        className={`${width} p-0`}
        onCloseAutoFocus={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
          {/* Grouped by department */}
          {sortedGroups.map((group, gi) => (
            <div key={group}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest bg-slate-50">
                {group}
              </DropdownMenuLabel>
              {grouped[group].map(value => (
                <label
                  key={value}
                  className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none"
                >
                  <Checkbox
                    checked={pending.includes(value)}
                    onCheckedChange={() => toggle(value)}
                  />
                  <span className="truncate">{value}</span>
                </label>
              ))}
            </div>
          ))}

          {/* Ungrouped (no department) */}
          {unGrouped.length > 0 && (
            <div>
              {sortedGroups.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50">
                    No Department
                  </DropdownMenuLabel>
                </>
              )}
              {unGrouped.map(value => (
                <label
                  key={value}
                  className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none"
                >
                  <Checkbox
                    checked={pending.includes(value)}
                    onCheckedChange={() => toggle(value)}
                  />
                  <span className="truncate">{value}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
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
