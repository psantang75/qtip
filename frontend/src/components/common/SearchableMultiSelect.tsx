import { useState, useMemo } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'

interface SearchableMultiSelectProps {
  /** Flat list of selectable items */
  items: { id: number; label: string }[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  /** Tailwind width class applied to both trigger and panel */
  width?: string
  emptyMessage?: string
}

/**
 * A generic multi-select dropdown with inline search, consistent checkbox
 * styling (shadcn DropdownMenuCheckboxItem), and a Clear / Done footer.
 * Matches the pattern of StagedMultiSelect but applies changes immediately.
 */
export function SearchableMultiSelect({
  items,
  selectedIds,
  onChange,
  placeholder = 'Select…',
  width = 'w-full',
  emptyMessage = 'No items found',
}: SearchableMultiSelectProps) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() =>
    search.trim()
      ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
      : items,
  [items, search])

  const label =
    selectedIds.length === 0 ? placeholder :
    selectedIds.length === 1 ? (items.find(i => i.id === selectedIds[0])?.label ?? '1 selected') :
    `${selectedIds.length} selected`

  const handleOpenChange = (o: boolean) => {
    setOpen(o)
    if (!o) setSearch('')
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`${width} justify-between font-normal text-[13px]`}>
          <span className="truncate">{label}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className={`${width} p-0`}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
          <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder="Search…"
            className="flex-1 text-[13px] text-slate-700 placeholder-slate-400 bg-transparent outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Options */}
        <div className="max-h-[260px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-[13px] text-slate-400 px-3 py-2">{emptyMessage}</p>
          ) : filtered.map(item => (
            <DropdownMenuCheckboxItem
              key={item.id}
              checked={selectedIds.includes(item.id)}
              onCheckedChange={checked =>
                onChange(checked
                  ? [...selectedIds, item.id]
                  : selectedIds.filter(x => x !== item.id))
              }
              onSelect={e => e.preventDefault()}
            >
              {item.label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 p-2 flex items-center justify-between gap-2">
          <button
            className="text-[11px] text-slate-400 hover:text-slate-600 px-1"
            onClick={() => onChange([])}
          >
            Clear
          </button>
          <Button size="sm" className="h-7 text-[12px]" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
