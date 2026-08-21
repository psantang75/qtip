import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

interface InlineTopicMultiSelectProps {
  /** Currently-applied topic labels. */
  selected: string[]
  /** Called with the new applied label list when the user clicks Apply. */
  onChange: (values: string[]) => void
  /** Trigger text shown when nothing is selected. */
  emptyLabel?: string
  /** Message shown when there are no active topics to pick from. */
  emptyDataMessage?: string
}

/**
 * Inline (expanding-panel) multi-select for training topics, grouped by
 * category with an "Uncategorized" bucket and draft/Apply staging.
 *
 * Extracted from the two write-up coaching modals (search + create-and-link),
 * which had a byte-for-byte copy of this picker. It keeps the inline-panel UX
 * those modals were built around (rather than the floating-dropdown shared
 * multi-selects) and fetches the `training_topic` list itself so both callers
 * share one source of truth. Callers keep their own field label/wrapper.
 */
export function InlineTopicMultiSelect({
  selected,
  onChange,
  emptyLabel = 'No topics selected',
  emptyDataMessage = 'No topics found',
}: InlineTopicMultiSelectProps) {
  const [open, setOpen]   = useState(false)
  const [draft, setDraft] = useState<Set<string>>(new Set())

  const { data: topicItems = [] } = useQuery({
    queryKey: ['list-items', 'training_topic'],
    queryFn:  () => import('@/services/listService').then(m => m.default.getItems('training_topic')),
    staleTime: 5 * 60_000,
  })
  const activeTopics = topicItems.filter(i => i.is_active)
  const categories   = useMemo(
    () => [...new Set(activeTopics.map(t => t.category).filter(Boolean))] as string[],
    [activeTopics],
  )
  const topicsByCat   = (cat: string) => activeTopics.filter(t => t.category === cat)
  const uncategorized = activeTopics.filter(t => !t.category)

  const openPanel = () => { setDraft(new Set(selected)); setOpen(true) }
  const apply     = () => { onChange(Array.from(draft)); setOpen(false) }
  const cancel    = () => setOpen(false)
  const toggle    = (label: string) => setDraft(prev => {
    const next = new Set(prev); if (next.has(label)) { next.delete(label) } else { next.add(label) } return next
  })

  const count = selected.length

  return (
    <div>
      <button type="button" onClick={openPanel}
        className="w-full flex items-center justify-between h-9 px-3 border border-slate-200 rounded-md bg-white text-[13px] hover:border-primary/50 transition-colors">
        <span className={count === 0 ? 'text-slate-400' : 'text-slate-700'}>
          {count === 0 ? emptyLabel : `${count} topic${count === 1 ? '' : 's'} selected`}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 border border-slate-200 rounded-lg bg-white overflow-hidden">
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            {activeTopics.length === 0 && (
              <p className="px-4 py-4 text-[13px] text-slate-400 text-center">{emptyDataMessage}</p>
            )}
            {categories.map(cat => (
              <div key={cat}>
                <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest bg-slate-50 border-b border-slate-100">{cat}</p>
                {topicsByCat(cat).map(t => (
                  <label key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none">
                    <Checkbox checked={draft.has(t.label)} onCheckedChange={() => toggle(t.label)} />{t.label}
                  </label>
                ))}
              </div>
            ))}
            {uncategorized.length > 0 && (
              <div>
                {categories.length > 0 && (
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">Uncategorized</p>
                )}
                {uncategorized.map(t => (
                  <label key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none">
                    <Checkbox checked={draft.has(t.label)} onCheckedChange={() => toggle(t.label)} />{t.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
            <button type="button" onClick={() => setDraft(new Set())} className="text-[12px] text-slate-400 hover:text-slate-600">Clear all</button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={cancel}>Cancel</Button>
              <Button type="button" size="sm" className="h-7 text-[12px] bg-primary hover:bg-primary/90 text-white" onClick={apply}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
