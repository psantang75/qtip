import { useState } from 'react'
import { getErrorMessage } from '@/utils/errorHandling'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { RichTextDisplay, stripHtml } from '@/components/common/RichTextDisplay'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { InlineTopicMultiSelect } from './InlineTopicMultiSelect'
import { Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { formatQualityDate } from '@/utils/dateFormat'
import { useToast } from '@/hooks/use-toast'
import trainingService from '@/services/trainingService'
import writeupService from '@/services/writeupService'

import listService from '@/services/listService'
import {
  COACHING_PURPOSE_LABELS as PURPOSE_LABELS,
  COACHING_FORMAT_LABELS as FORMAT_LABELS,
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
  // Coaching purpose/source/format are List-Management list_items.id values.
  const [purpose,        setPurpose]       = useState<number | ''>('')
  const [source,         setSource]        = useState<number | ''>('')
  const [format,         setFormat]        = useState<number | ''>('')
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [notes,          setNotes]         = useState('')

  const { data: purposeItems = [] } = useQuery({ queryKey: ['list-items', 'coaching_purpose'], queryFn: () => listService.getItems('coaching_purpose'), staleTime: 5 * 60_000 })
  const { data: sourceItems = [] }  = useQuery({ queryKey: ['list-items', 'coaching_source'],  queryFn: () => listService.getItems('coaching_source'),  staleTime: 5 * 60_000 })
  const { data: formatItems = [] }  = useQuery({ queryKey: ['list-items', 'coaching_format'],  queryFn: () => listService.getItems('coaching_format'),  staleTime: 5 * 60_000 })

  const createMut = useMutation({
    mutationFn: () => writeupService.createLinkedCoachingSession({
      csr_id: csrId, session_date: date, coaching_purpose: purpose ? String(purpose) : undefined,
      coaching_format: format ? String(format) : undefined, source_type: source ? String(source) : undefined,
      topic_names: selectedTopics.size > 0 ? Array.from(selectedTopics) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: ({ id, label }) => { onCreated(id, label); onClose() },
    onError: (err: any) => toast({
      variant: 'destructive',
      title: "Couldn't create coaching session",
      description: getErrorMessage(err, 'Try again.'),
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
              <Select value={purpose ? String(purpose) : ''} onValueChange={v => setPurpose(Number(v))}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Select purpose…" /></SelectTrigger>
                <SelectContent>
                  {purposeItems.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <Select value={source ? String(source) : ''} onValueChange={v => setSource(Number(v))}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Select source…" /></SelectTrigger>
                <SelectContent>
                  {sourceItems.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Format" required>
              <Select value={format ? String(format) : ''} onValueChange={v => setFormat(Number(v))}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Select format…" /></SelectTrigger>
                <SelectContent>
                  {formatItems.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Topics">
            <InlineTopicMultiSelect
              selected={Array.from(selectedTopics)}
              onChange={vals => setSelectedTopics(new Set(vals))}
              emptyLabel="No topics selected"
              emptyDataMessage="No topics found in list management"
            />
          </Field>

          <Field label="Notes">
            <RichTextEditor className="text-[13px]" placeholder="Optional notes…" value={notes} onChange={setNotes} />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="button" size="sm" className="bg-primary hover:bg-primary/90 text-white"
              disabled={!date || !purpose || !format || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? 'Creating…' : 'Create & Link'}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}
