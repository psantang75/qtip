import { useState, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatQualityDate, priorNinetyDays } from '@/utils/dateFormat'
import { stripHtml } from '@/components/common/RichTextDisplay'
import { useToast } from '@/hooks/use-toast'
import writeupService, { type CoachingSearchResult } from '@/services/writeupService'
import { COACHING_PURPOSE_LABELS } from '@/constants/labels'
import type { ExampleInput, PriorDisciplineRef } from './types'

// Local `getPrior90Days` removed during pre-production review (item #27);
// the shared helper `priorNinetyDays` in `@/utils/dateFormat` is used by both
// writeup search modals so the default range cannot drift.

interface CoachingSearchModalProps {
  csrId: number
  onImport?: (examples: ExampleInput[]) => void
  onImportRefs?: (refs: PriorDisciplineRef[]) => void
  onClose: () => void
}

export function CoachingSearchModal({ csrId, onImport, onImportRefs, onClose }: CoachingSearchModalProps) {
  const { toast }                       = useToast()
  const defaults = priorNinetyDays()
  const [dateFrom, setDateFrom]         = useState(defaults.from)
  const [dateTo, setDateTo]             = useState(defaults.to)
  const [selectedTopics, setTopics]     = useState<Set<string>>(new Set())
  const [draftTopics, setDraftTopics]   = useState<Set<string>>(new Set())
  const [topicOpen, setTopicOpen]       = useState(false)
  const [results, setResults]           = useState<CoachingSearchResult[]>([])
  const [selected, setSelected]         = useState<Set<number>>(new Set())

  const { data: topicItems = [] } = useQuery({
    queryKey: ['list-items', 'training_topic'],
    queryFn:  () => import('@/services/listService').then(m => m.default.getItems('training_topic')),
    staleTime: 5 * 60_000,
  })
  const activeTopics    = topicItems.filter(i => i.is_active)
  const topicCategories = useMemo(() => [...new Set(activeTopics.map(t => t.category).filter(Boolean))] as string[], [activeTopics])
  const topicsByCat     = (cat: string) => activeTopics.filter(t => t.category === cat)
  const uncategorizedTopics = activeTopics.filter(t => !t.category)

  const openTopicDropdown = () => { setDraftTopics(new Set(selectedTopics)); setTopicOpen(true) }
  const applyTopics       = () => { setTopics(new Set(draftTopics)); setTopicOpen(false) }
  const cancelTopics      = () => setTopicOpen(false)
  const toggleDraft       = (label: string) => setDraftTopics(prev => { const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next })

  const searchMut = useMutation({
    mutationFn: () => writeupService.searchCoachingSessions({ csr_id: csrId, date_from: dateFrom || undefined, date_to: dateTo || undefined, topic_names: selectedTopics.size > 0 ? Array.from(selectedTopics) : undefined }),
    onSuccess: (data) => { setResults(data); setSelected(new Set()) },
    onError: () => toast({ title: 'Search failed', description: 'Could not load coaching sessions.', variant: 'destructive' }),
  })

  const toggleResult = (idx: number) => setSelected(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })

  const handleImport = () => {
    if (onImportRefs) {
      const refs: PriorDisciplineRef[] = Array.from(selected).map(idx => {
        const r = results[idx]
        const topics: string[] = Array.isArray(r.topic_names) ? r.topic_names.filter(Boolean) : r.topic_names ? [r.topic_names] : []
        return { reference_type: 'coaching_session' as const, reference_id: r.session_id, label: `Coaching #${r.session_id}`, date: r.session_date?.slice(0, 10), subtype: COACHING_PURPOSE_LABELS[r.coaching_purpose as keyof typeof COACHING_PURPOSE_LABELS] ?? (r.coaching_purpose ?? 'Coaching'), detail: topics, notes: r.notes as string | undefined, status: r.status as string | undefined }
      })
      onImportRefs(refs)
    } else if (onImport) {
      const examples: ExampleInput[] = Array.from(selected).map(idx => {
        const r = results[idx]
        const topicStr = Array.isArray(r.topic_names) ? r.topic_names.join(', ') : (r.topic_names ?? '')
        return { example_date: r.session_date?.slice(0, 10) ?? '', description: `[${r.coaching_purpose ?? 'Coaching'}]${topicStr ? ` ${topicStr}` : ''} — ${stripHtml(r.notes).slice(0, 100)}`, source: 'COACHING_IMPORT' as const, sort_order: idx }
      })
      onImport(examples)
    }
    onClose()
  }

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <DialogTitle>Search Coaching Sessions</DialogTitle>
        <DialogDescription className="sr-only">Search coaching sessions by topic and date for the selected employee.</DialogDescription>
      </DialogHeader>

      {!csrId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
          <Search className="h-8 w-8 text-slate-200" />
          <p className="text-[14px] font-semibold text-slate-500">No employee selected</p>
          <p className="text-[13px] text-slate-400 max-w-xs">Select an employee at the top of the write-up form before searching coaching sessions.</p>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 shrink-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Topics</p>
            <button type="button" onClick={openTopicDropdown}
              className="w-full flex items-center justify-between h-9 px-3 border border-slate-200 rounded-md bg-white text-[13px] hover:border-primary/50 transition-colors">
              <span className={selectedTopics.size === 0 ? 'text-slate-400' : 'text-slate-700'}>
                {selectedTopics.size === 0 ? 'All topics (no filter)' : `${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'} selected`}
              </span>
              <ChevronDown className={cn('h-4 w-4 text-slate-400 shrink-0 transition-transform', topicOpen && 'rotate-180')} />
            </button>
            {topicOpen && (
              <div className="mt-1 border border-slate-200 rounded-lg bg-white overflow-hidden">
                <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
                  {activeTopics.length === 0 && <p className="px-4 py-4 text-[13px] text-slate-400 text-center">No topics found</p>}
                  {topicCategories.map(cat => (
                    <div key={cat}>
                      <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest bg-slate-50 border-b border-slate-100">{cat}</p>
                      {topicsByCat(cat).map(t => (
                        <label key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none">
                          <Checkbox checked={draftTopics.has(t.label)} onCheckedChange={() => toggleDraft(t.label)} />{t.label}
                        </label>
                      ))}
                    </div>
                  ))}
                  {uncategorizedTopics.length > 0 && (
                    <div>
                      {topicCategories.length > 0 && <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">Uncategorized</p>}
                      {uncategorizedTopics.map(t => (
                        <label key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none">
                          <Checkbox checked={draftTopics.has(t.label)} onCheckedChange={() => toggleDraft(t.label)} />{t.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
                  <button type="button" onClick={() => setDraftTopics(new Set())} className="text-[12px] text-slate-400 hover:text-slate-600">Clear all</button>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={cancelTopics}>Cancel</Button>
                    <Button type="button" size="sm" className="h-7 text-[12px] bg-primary hover:bg-primary/90 text-white" onClick={applyTopics}>Apply</Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-b border-slate-100 shrink-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Session Date Range</p>
            <div className="flex items-center gap-2">
              <Input type="date" className="h-8 text-[12px] flex-1" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-slate-400 text-[11px] shrink-0">to</span>
              <Input type="date" className="h-8 text-[12px] flex-1" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>

          <div className="px-5 py-3 border-b border-slate-100 shrink-0">
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={() => searchMut.mutate()} disabled={searchMut.isPending}>
              <Search className="h-3.5 w-3.5 mr-1.5" />{searchMut.isPending ? 'Searching…' : 'Search'}
            </Button>
          </div>

          <div className="overflow-y-auto flex-1">
            {results.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-8 text-center">{searchMut.isIdle ? 'Run a search to see results' : 'No results found'}</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50/50 cursor-pointer" onClick={() => toggleResult(i)}>
                    <Checkbox className="mt-0.5" checked={selected.has(i)} onCheckedChange={() => toggleResult(i)} onClick={e => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-medium text-slate-700">{r.coaching_purpose ?? '—'}</span>
                        <span className="text-[11px] text-slate-400">{formatQualityDate(r.session_date)}</span>
                      </div>
                      {(r.topic_names as any)?.length > 0 && (
                        <p className="text-[11px] text-slate-500 mt-0.5">{Array.isArray(r.topic_names) ? r.topic_names.join(', ') : r.topic_names}</p>
                      )}
                      {r.notes && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{stripHtml(r.notes).slice(0, 100)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <span className="text-[13px] text-slate-500">{selected.size} selected</span>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={handleImport}>
                {onImportRefs ? 'Add to Prior Discipline' : 'Add to Write-Up'}
              </Button>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  )
}
