import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InlineTopicMultiSelect } from './InlineTopicMultiSelect'
import { formatQualityDate, priorNinetyDays } from '@/utils/dateFormat'
import { stripHtml } from '@/utils/htmlText'
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
  const [results, setResults]           = useState<CoachingSearchResult[]>([])
  const [selected, setSelected]         = useState<Set<number>>(new Set())

  const searchMut = useMutation({
    mutationFn: () => writeupService.searchCoachingSessions({ csr_id: csrId, date_from: dateFrom || undefined, date_to: dateTo || undefined, topic_names: selectedTopics.size > 0 ? Array.from(selectedTopics) : undefined }),
    onSuccess: (data) => { setResults(data); setSelected(new Set()) },
    onError: () => toast({
      variant: 'destructive',
      title: "Couldn't search coaching sessions",
      description: 'Try again.',
    }),
  })

  const toggleResult = (idx: number) => setSelected(prev => { const next = new Set(prev); if (next.has(idx)) { next.delete(idx) } else { next.add(idx) } return next })

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
            <InlineTopicMultiSelect
              selected={Array.from(selectedTopics)}
              onChange={vals => setTopics(new Set(vals))}
              emptyLabel="All topics (no filter)"
            />
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
                      {(r.topic_names?.length ?? 0) > 0 && (
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
