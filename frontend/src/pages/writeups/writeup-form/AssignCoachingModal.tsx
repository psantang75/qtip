import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { RichTextDisplay, stripHtml } from '@/components/common/RichTextDisplay'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { formatQualityDate } from '@/utils/dateFormat'
import { useToast } from '@/hooks/use-toast'
import trainingService from '@/services/trainingService'
import writeupService from '@/services/writeupService'

import {
  COACHING_PURPOSE_LABELS as PURPOSE_LABELS,
  COACHING_FORMAT_LABELS as FORMAT_LABELS,
  COACHING_SOURCE_LABELS as SOURCE_LABELS,
} from '@/constants/labels'

const OPEN_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'IN_PROCESS', 'PENDING_CSR', 'AWAITING_CSR_ACTION', 'FOLLOW_UP_REQUIRED']

export function AssignCoachingModal({ csrId, onSelect, onClose }: {
  csrId: number
  onSelect: (id: number, label: string) => void
  onClose: () => void
}) {
  const { data: sessionData, isLoading } = useQuery({
    queryKey: ['coaching-sessions-for-writeup', csrId],
    queryFn:  () => trainingService.getCoachingSessions({ csr_id: csrId, limit: 100 }),
    enabled:  csrId > 0,
  })

  const sessions = (sessionData?.items ?? []).filter(
    (s: any) => OPEN_STATUSES.includes(s.status ?? '')
  )

  return (
    <DialogContent className="max-w-5xl max-h-[80vh] flex flex-col gap-0 p-0">
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <DialogTitle>Link Coaching Session</DialogTitle>
        <DialogDescription className="text-[13px] text-slate-500">
          Open sessions only. Click a row to link it to this write-up.
        </DialogDescription>
      </DialogHeader>

      <div className="overflow-y-auto flex-1">
        {!csrId ? (
          <p className="text-[13px] text-slate-400 py-8 text-center">Select an employee first</p>
        ) : isLoading ? (
          <p className="text-[13px] text-slate-400 py-8 text-center">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="text-[13px] text-slate-400 py-8 text-center">No open coaching sessions found for this employee</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-14 text-[11px]">#</TableHead>
                <TableHead className="w-24 text-[11px]">Date</TableHead>
                <TableHead className="w-28 text-[11px]">Status</TableHead>
                <TableHead className="w-28 text-[11px]">Purpose</TableHead>
                <TableHead className="w-28 text-[11px]">Format</TableHead>
                <TableHead className="w-36 text-[11px]">Topics</TableHead>
                <TableHead className="text-[11px]">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s: any) => {
                const topics: string[] = Array.isArray(s.topics) ? s.topics.filter(Boolean)
                  : Array.isArray(s.topic_names) ? s.topic_names.filter(Boolean)
                  : s.topic_names ? [s.topic_names] : []
                const label = `${PURPOSE_LABELS[s.coaching_purpose ?? ''] ?? s.coaching_purpose ?? 'Coaching'} — ${formatQualityDate(s.session_date)}`
                return (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => { onSelect(s.id, label); onClose() }}>
                    <TableCell className="text-[11px] text-slate-400 font-mono">#{s.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{formatQualityDate(s.session_date)}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{(s.status ?? '').replace(/_/g, ' ')}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{PURPOSE_LABELS[s.coaching_purpose ?? ''] ?? s.coaching_purpose ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-slate-600">{FORMAT_LABELS[s.coaching_format ?? ''] ?? s.coaching_format?.replace(/_/g, ' ') ?? '—'}</TableCell>
                    <TableCell className="max-w-[144px]">
                      {topics.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block max-w-[144px] cursor-default">{[...topics].sort().join(', ')}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">{[...topics].sort().map(t => (
                              <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                              </li>
                            ))}</ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-[13px] text-slate-300">&mdash;</span>}
                    </TableCell>
                    <TableCell>
                      {s.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block max-w-[200px] cursor-default">{stripHtml(s.notes)}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <RichTextDisplay html={s.notes} />
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-[13px] text-slate-300">&mdash;</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </DialogContent>
  )
}

export function CreateCoachingModal({ csrId, onCreated, onClose }: {
  csrId: number
  onCreated: (id: number, label: string) => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const [date,           setDate]          = useState('')
  const [purpose,        setPurpose]       = useState('PERFORMANCE')
  const [source,         setSource]        = useState('OTHER')
  const [format,         setFormat]        = useState('ONE_ON_ONE')
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [draftTopics,    setDraftTopics]   = useState<Set<string>>(new Set())
  const [topicOpen,      setTopicOpen]     = useState(false)
  const [notes,          setNotes]         = useState('')

  const { data: topicItems = [] } = useQuery({
    queryKey: ['list-items', 'training_topic'],
    queryFn:  () => import('@/services/listService').then(m => m.default.getItems('training_topic')),
    staleTime: 5 * 60_000,
  })
  const activeTopics        = (topicItems as any[]).filter(t => t.is_active)
  const topicCategories     = useMemo(() => [...new Set(activeTopics.map((t: any) => t.category).filter(Boolean))] as string[], [activeTopics])
  const topicsByCat         = (cat: string) => activeTopics.filter((t: any) => t.category === cat)
  const uncategorizedTopics = activeTopics.filter((t: any) => !t.category)

  const openTopicDropdown = () => { setDraftTopics(new Set(selectedTopics)); setTopicOpen(true) }
  const applyTopics       = () => { setSelectedTopics(new Set(draftTopics)); setTopicOpen(false) }
  const cancelTopics      = () => setTopicOpen(false)
  const toggleDraft       = (label: string) => setDraftTopics(prev => {
    const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next
  })

  const createMut = useMutation({
    mutationFn: () => writeupService.createLinkedCoachingSession({
      csr_id: csrId, session_date: date, coaching_purpose: purpose,
      coaching_format: format, source_type: source,
      topic_names: selectedTopics.size > 0 ? Array.from(selectedTopics) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: ({ id, label }) => { onCreated(id, label); onClose() },
    onError: (err: any) => toast({
      title: 'Failed to create session',
      description: err?.response?.data?.message ?? err?.message ?? 'Please try again.',
      variant: 'destructive',
    }),
  })

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Create &amp; Link Coaching Session</DialogTitle>
        <DialogDescription className="text-[13px] text-slate-500">
          Creates a new coaching session linked to this write-up. Add full details in Training after saving.
        </DialogDescription>
      </DialogHeader>

      {!csrId ? (
        <p className="text-[13px] text-slate-400 py-4 text-center">Select an employee first</p>
      ) : (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Session Date" required>
              <Input type="date" className="h-9 text-[13px]" value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <Field label="Purpose" required>
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERFORMANCE">Performance</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="ONBOARDING">Onboarding</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="QA_AUDIT">QA Audit</SelectItem>
                  <SelectItem value="MANAGER_OBSERVATION">Manager Observation</SelectItem>
                  <SelectItem value="TREND">Trend</SelectItem>
                  <SelectItem value="DISPUTE">Dispute</SelectItem>
                  <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Format" required>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONE_ON_ONE">One-on-One</SelectItem>
                  <SelectItem value="SIDE_BY_SIDE">Side-by-Side</SelectItem>
                  <SelectItem value="TEAM_SESSION">Team Session</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Topics">
            <button type="button" onClick={openTopicDropdown}
              className="w-full flex items-center justify-between h-9 px-3 border border-slate-200 rounded-md bg-white text-[13px] hover:border-primary/50 transition-colors">
              <span className={selectedTopics.size === 0 ? 'text-slate-400' : 'text-slate-700'}>
                {selectedTopics.size === 0 ? 'No topics selected' : `${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'} selected`}
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${topicOpen ? 'rotate-180' : ''}`} />
            </button>
            {topicOpen && (
              <div className="mt-1 border border-slate-200 rounded-lg bg-white overflow-hidden">
                <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
                  {activeTopics.length === 0 && (
                    <p className="px-4 py-4 text-[13px] text-slate-400 text-center">No topics found in list management</p>
                  )}
                  {topicCategories.map(cat => (
                    <div key={cat}>
                      <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest bg-slate-50 border-b border-slate-100">{cat}</p>
                      {topicsByCat(cat).map((t: any) => (
                        <label key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none">
                          <Checkbox checked={draftTopics.has(t.label)} onCheckedChange={() => toggleDraft(t.label)} />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  ))}
                  {uncategorizedTopics.length > 0 && (
                    <div>
                      {topicCategories.length > 0 && (
                        <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">Uncategorized</p>
                      )}
                      {uncategorizedTopics.map((t: any) => (
                        <label key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none">
                          <Checkbox checked={draftTopics.has(t.label)} onCheckedChange={() => toggleDraft(t.label)} />
                          {t.label}
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
          </Field>

          <Field label="Notes">
            <RichTextEditor className="text-[13px]" placeholder="Optional notes…" value={notes} onChange={setNotes} />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="button" size="sm" className="bg-primary hover:bg-primary/90 text-white"
              disabled={!date || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? 'Creating…' : 'Create & Link'}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}
