import { useState, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { History, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { formatQualityDate } from '@/utils/dateFormat'
import { useToast } from '@/hooks/use-toast'
import writeupService from '@/services/writeupService'
import {
  WRITE_UP_TYPE_LABELS as WRITEUP_TYPE_LABELS,
  WRITE_UP_STATUS_LABELS as WRITEUP_STATUS_LABELS,
} from '../writeupLabels'
import listService from '@/services/listService'
import type { PriorDisciplineRef } from './types'

interface PriorDisciplineModalProps {
  csrId: number
  selected: PriorDisciplineRef[]
  onSave: (refs: PriorDisciplineRef[]) => void
  onClose: () => void
}

export function PriorDisciplineModal({ csrId, selected, onSave, onClose }: PriorDisciplineModalProps) {
  const { toast }   = useToast()
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom]         = useState(twoYearsAgo)
  const [dateTo, setDateTo]             = useState('')
  const [topicFilter, setTopicFilter]   = useState('')
  const [policyFilter, setPolicyFilter] = useState('')
  const [draft, setDraft] = useState<Set<string>>(
    new Set(selected.map(r => `${r.reference_type}:${r.reference_id}`))
  )

  const { data: topicItems  = [] } = useQuery({ queryKey: ['list-items', 'training_topic'], queryFn: () => listService.getItems('training_topic'), staleTime: 5 * 60_000 })
  const { data: policyItems = [] } = useQuery({ queryKey: ['list-items', 'writeup_policy'],  queryFn: () => listService.getItems('writeup_policy'),  staleTime: 5 * 60_000 })

  const activeTopics   = topicItems.filter(i => i.is_active)
  const activePolicies = policyItems.filter(i => i.is_active)

  const fetchMut = useMutation({
    mutationFn: () => writeupService.getPriorDiscipline(csrId),
    onError: () => toast({ title: 'Failed to load discipline history', variant: 'destructive' }),
  })
  const data = fetchMut.data

  const filterByDate = (dateStr?: string | null) => {
    if (!dateStr) return true
    const d = dateStr.slice(0, 10)
    if (dateFrom && d < dateFrom) return false
    if (dateTo   && d > dateTo)   return false
    return true
  }

  const writeUps = useMemo(() => {
    const all = data?.write_ups ?? []
    return all.filter((w: any) => {
      if (!filterByDate(w.meeting_date ?? w.created_at)) return false
      if (policyFilter && policyFilter !== '__all__') {
        const policies: string[] = w.policies_violated ?? []
        if (!policies.some(p => p.toLowerCase().includes(policyFilter.toLowerCase()))) return false
      }
      return true
    })
  }, [data, dateFrom, dateTo, policyFilter])

  const coachingSessions = useMemo(() => {
    const all = data?.coaching_sessions ?? []
    return all.filter((c: any) => {
      if (!filterByDate(c.session_date)) return false
      if (topicFilter && topicFilter !== '__all__') {
        const topics: string[] = c.topic_names ?? []
        if (!topics.some(t => t.toLowerCase().includes(topicFilter.toLowerCase()))) return false
      }
      return true
    })
  }, [data, dateFrom, dateTo, topicFilter])

  const toggle = (type: 'write_up' | 'coaching_session', id: number) => {
    const key = `${type}:${id}`
    setDraft(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }

  const handleSave = () => {
    const refs: PriorDisciplineRef[] = []
    draft.forEach(key => {
      const [type, idStr] = key.split(':')
      const id = Number(idStr)
      const refType = type as 'write_up' | 'coaching_session'
      const item = refType === 'write_up'
        ? (data?.write_ups ?? []).find((w: any) => Number(w.id) === id)
        : (data?.coaching_sessions ?? []).find((c: any) => Number(c.id) === id)

      if (!item) {
        const existingRef = selected.find(r => r.reference_type === refType && r.reference_id === id)
        if (existingRef) refs.push(existingRef)
        return
      }

      if (refType === 'write_up') {
        const typeLabel = (item.document_type ?? '').replace('_WARNING', '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
        refs.push({ reference_type: refType, reference_id: id, label: `Write-Up #${id}`, date: item.meeting_date?.slice(0, 10) ?? item.created_at?.slice(0, 10), subtype: typeLabel || 'Warning', detail: Array.isArray(item.policies_violated) ? item.policies_violated.filter(Boolean) : [], notes: Array.isArray(item.incident_descriptions) && item.incident_descriptions.length ? item.incident_descriptions.join(' · ') : undefined, status: item.status })
      } else {
        const purposeLabel: Record<string, string> = { WEEKLY: 'Weekly', PERFORMANCE: 'Performance', ONBOARDING: 'Onboarding' }
        refs.push({ reference_type: refType, reference_id: id, label: `Coaching #${id}`, date: item.session_date?.slice(0, 10), subtype: purposeLabel[item.coaching_purpose ?? ''] ?? (item.coaching_purpose ?? 'Coaching'), detail: Array.isArray(item.topic_names) ? item.topic_names.filter(Boolean) : [], notes: item.notes ?? undefined, status: item.status })
      }
    })
    onSave(refs)
    onClose()
  }

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <DialogTitle>Prior Discipline & Coaching History</DialogTitle>
        <DialogDescription className="sr-only">Browse and link prior write-ups and coaching sessions for this employee.</DialogDescription>
      </DialogHeader>

      {!csrId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
          <History className="h-8 w-8 text-slate-200" />
          <p className="text-[14px] font-semibold text-slate-500">No employee selected</p>
          <p className="text-[13px] text-slate-400 max-w-xs">Select an employee at the top of the write-up form first.</p>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 shrink-0 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Input type="date" className="h-8 text-[12px] w-34" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-slate-400 text-[11px] shrink-0">to</span>
              <Input type="date" className="h-8 text-[12px] w-34" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white shrink-0"
              onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
              {fetchMut.isPending ? 'Loading…' : 'Load History'}
            </Button>
          </div>

          {fetchMut.data ? (
            <Tabs defaultValue="coaching" className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-5 mt-3 shrink-0 self-start">
                <TabsTrigger value="coaching">Coaching History ({coachingSessions.length})</TabsTrigger>
                <TabsTrigger value="warnings">Prior Discipline ({writeUps.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="coaching" className="flex flex-col flex-1 min-h-0 mt-0">
                <div className="px-5 py-2.5 border-b border-slate-100 shrink-0">
                  <Select value={topicFilter || '__all__'} onValueChange={v => setTopicFilter(v === '__all__' ? '' : v)}>
                    <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Filter by topic…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All topics</SelectItem>
                      {activeTopics.map(t => <SelectItem key={t.id} value={t.label}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="overflow-y-auto flex-1">
                  {coachingSessions.length === 0 ? (
                    <p className="text-[13px] text-slate-400 py-6 text-center">No coaching sessions found</p>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {coachingSessions.map((c: any) => {
                        const key = `coaching_session:${c.id}`
                        const topics: string[] = c.topic_names ?? []
                        return (
                          <div key={c.id} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50 cursor-pointer" onClick={() => toggle('coaching_session', c.id)}>
                            <Checkbox className="mt-0.5" checked={draft.has(key)} onCheckedChange={() => toggle('coaching_session', c.id)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-medium text-slate-700">{c.coaching_purpose ?? '—'}</span>
                                <span className="text-[11px] text-slate-400">{formatQualityDate(c.session_date)}</span>
                              </div>
                              {topics.length > 0 && <p className="text-[11px] text-primary mt-0.5">{topics.join(', ')}</p>}
                              {c.notes && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{c.notes}</p>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="warnings" className="flex flex-col flex-1 min-h-0 mt-0">
                <div className="px-5 py-2.5 border-b border-slate-100 shrink-0">
                  <Select value={policyFilter || '__all__'} onValueChange={v => setPolicyFilter(v === '__all__' ? '' : v)}>
                    <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Filter by policy violated…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All policies</SelectItem>
                      {activePolicies.map(p => <SelectItem key={p.id} value={p.label}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="overflow-y-auto flex-1">
                  {writeUps.length === 0 ? (
                    <p className="text-[13px] text-slate-400 py-6 text-center">No prior warnings found</p>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {writeUps.map((w: any) => {
                        const key = `write_up:${w.id}`
                        const policies: string[] = w.policies_violated ?? []
                        return (
                          <div key={w.id} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50 cursor-pointer" onClick={() => toggle('write_up', w.id)}>
                            <Checkbox className="mt-0.5" checked={draft.has(key)} onCheckedChange={() => toggle('write_up', w.id)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[12px] font-medium text-slate-700">{WRITEUP_TYPE_LABELS[w.document_type] ?? w.document_type}</span>
                                <span className="text-[12px] text-slate-500">{WRITEUP_STATUS_LABELS[w.status] ?? w.status}</span>
                                <span className="text-[11px] text-slate-400">{formatQualityDate(w.meeting_date ?? w.created_at)}</span>
                              </div>
                              {policies.length > 0 && <p className="text-[11px] text-slate-500 mt-0.5">{policies.join(', ')}</p>}
                            </div>
                            <a href={`/app/writeups/${w.id}`} target="_blank" rel="noreferrer"
                              className="shrink-0 text-slate-400 hover:text-primary mt-0.5" onClick={e => e.stopPropagation()}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12 text-center">
              <History className="h-8 w-8 text-slate-200" />
              <p className="text-[13px] text-slate-400">Click "Load History" to retrieve records</p>
            </div>
          )}

          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <span className="text-[13px] text-slate-500">{draft.size > 0 ? `${draft.size} item${draft.size !== 1 ? 's' : ''} selected` : 'None selected'}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" disabled={draft.size === 0} onClick={handleSave}>Add Selected</Button>
            </div>
          </div>
        </div>
      )}
    </DialogContent>
  )
}
