import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ChevronDown, Download, ExternalLink, Link2, Paperclip, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { FormSection, Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { formatQualityDate } from '@/utils/dateFormat'
import { useToast } from '@/hooks/use-toast'
import userService from '@/services/userService'
import trainingService from '@/services/trainingService'
import listService from '@/services/listService'
import writeupService from '@/services/writeupService'
import type { WriteUpFormState } from './types'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

// ── Section 1: Employee & Document Type ──────────────────────────────────────

export function EmployeeSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const { data: csrsData } = useQuery({
    queryKey: ['csrs-for-writeup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 3, is_active: true }),
    staleTime: 60_000,
  })
  const { data: managersData } = useQuery({
    queryKey: ['managers-for-writeup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 5, is_active: true }),
    staleTime: 60_000,
  })
  const { data: adminsData } = useQuery({
    queryKey: ['admins-for-writeup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 1, is_active: true }),
    staleTime: 60_000,
  })

  // Group CSRs by department (alpha), employees alpha within each group
  const csrsByDept = useMemo(() => {
    const items = [...(csrsData?.items ?? [])]
    const grouped: Record<string, typeof items> = {}
    for (const u of items) {
      const dept = u.department_name ?? ''
      if (!grouped[dept]) grouped[dept] = []
      grouped[dept].push(u)
    }
    const sortedDepts = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
    sortedDepts.forEach(d => grouped[d].sort((a, b) => a.username.localeCompare(b.username)))
    return { grouped, sortedDepts }
  }, [csrsData])

  const staffOptions = useMemo(() => {
    const combined = [...(managersData?.items ?? []), ...(adminsData?.items ?? [])]
    return combined
      .filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i)
      .sort((a, b) => a.username.localeCompare(b.username))
  }, [managersData, adminsData])

  return (
    <FormSection title="Employee & Document Type">
      {/* Row 1: Employee, Document Type */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Field label="Employee" required>
          <Select
            value={form.csr_id ? String(form.csr_id) : ''}
            onValueChange={v => update('csr_id', Number(v))}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select employee…" />
            </SelectTrigger>
            <SelectContent>
              {csrsByDept.sortedDepts.map((dept, i) => (
                <SelectGroup key={dept}>
                  {i > 0 && <SelectSeparator />}
                  <SelectLabel className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 py-1">
                    {dept || 'No Department'}
                  </SelectLabel>
                  {csrsByDept.grouped[dept].map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.username}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Document Type" required>
          <Select
            value={form.document_type}
            onValueChange={v => update('document_type', v as WriteUpFormState['document_type'])}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="VERBAL_WARNING">Verbal Warning</SelectItem>
              <SelectItem value="WRITTEN_WARNING">Written Warning</SelectItem>
              <SelectItem value="FINAL_WARNING">Final Warning</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Row 2: Manager, HR Witness, Meeting Date */}
      {(() => {
        const samePersonError =
          form.manager_id > 0 &&
          form.hr_witness_id > 0 &&
          form.manager_id === form.hr_witness_id
        return (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Manager">
                <Select
                  value={form.manager_id ? String(form.manager_id) : ''}
                  onValueChange={v => update('manager_id', Number(v))}
                >
                  <SelectTrigger className={`h-9 text-[13px] ${samePersonError ? 'border-red-400 focus:ring-red-400' : ''}`}>
                    <SelectValue placeholder="Select manager…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffOptions.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="HR Witness">
                <Select
                  value={form.hr_witness_id ? String(form.hr_witness_id) : ''}
                  onValueChange={v => update('hr_witness_id', Number(v))}
                >
                  <SelectTrigger className={`h-9 text-[13px] ${samePersonError ? 'border-red-400 focus:ring-red-400' : ''}`}>
                    <SelectValue placeholder="Select HR witness…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffOptions.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Meeting Date">
                <Input
                  type="date"
                  className="h-9 text-[13px]"
                  value={form.meeting_date}
                  onChange={e => update('meeting_date', e.target.value)}
                />
              </Field>
            </div>
            {samePersonError && (
              <p className="text-[12px] text-red-500 mt-1">
                Manager and HR Witness cannot be the same person.
              </p>
            )}
          </>
        )
      })()}
    </FormSection>
  )
}

// ── Shared label maps ─────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly', PERFORMANCE: 'Performance', ONBOARDING: 'Onboarding',
}
const FORMAT_LABELS: Record<string, string> = {
  ONE_ON_ONE: 'One-on-One', SIDE_BY_SIDE: 'Side-by-Side', TEAM_SESSION: 'Team Session',
}
const SOURCE_LABELS: Record<string, string> = {
  QA_AUDIT: 'QA Audit', MANAGER_OBSERVATION: 'Manager Obs.', TREND: 'Trend',
  DISPUTE: 'Dispute', SCHEDULED: 'Scheduled', OTHER: 'Other',
}
const SESSION_STATUS_COLORS: Record<string, string> = {
  SCHEDULED:          'bg-blue-100 text-blue-700',
  IN_PROGRESS:        'bg-yellow-100 text-yellow-700',
  IN_PROCESS:         'bg-yellow-100 text-yellow-700',
  PENDING_CSR:        'bg-orange-100 text-orange-700',
  AWAITING_CSR_ACTION:'bg-orange-100 text-orange-700',
  COMPLETED:          'bg-green-100 text-green-700',
  FOLLOW_UP_REQUIRED: 'bg-purple-100 text-purple-700',
  CLOSED:             'bg-slate-100 text-slate-500',
}

// ── Assign Coaching Modal ─────────────────────────────────────────────────────

const OPEN_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'IN_PROCESS', 'PENDING_CSR', 'AWAITING_CSR_ACTION', 'FOLLOW_UP_REQUIRED']

function AssignCoachingModal({ csrId, onSelect, onClose }: {
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
                const statusKey = s.status ?? ''
                const label = `${PURPOSE_LABELS[s.coaching_purpose ?? ''] ?? s.coaching_purpose ?? 'Coaching'} — ${formatQualityDate(s.session_date)}`
                return (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => { onSelect(s.id, label); onClose() }}
                  >
                    <TableCell className="text-[11px] text-slate-400 font-mono">#{s.id}</TableCell>
                    <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                      {formatQualityDate(s.session_date)}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {statusKey.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {PURPOSE_LABELS[s.coaching_purpose ?? ''] ?? s.coaching_purpose ?? '—'}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {FORMAT_LABELS[s.coaching_format ?? ''] ?? s.coaching_format?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>

                    {/* Topics — truncated, bulleted list on hover */}
                    <TableCell className="max-w-[144px]">
                      {topics.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block max-w-[144px] cursor-default">
                              {[...topics].sort().join(', ')}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">
                              {[...topics].sort().map(t => (
                                <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[13px] text-slate-300">&mdash;</span>
                      )}
                    </TableCell>

                    {/* Notes — truncated, full text on hover */}
                    <TableCell>
                      {s.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block max-w-[200px] cursor-default">
                              {s.notes}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{s.notes}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[13px] text-slate-300">&mdash;</span>
                      )}
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

// ── Create & Link Coaching Modal ──────────────────────────────────────────────

function CreateCoachingModal({ csrId, onCreated, onClose }: {
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
      csr_id:           csrId,
      session_date:     date,
      coaching_purpose: purpose,
      coaching_format:  format,
      source_type:      source,
      topic_names:      selectedTopics.size > 0 ? Array.from(selectedTopics) : undefined,
      notes:            notes || undefined,
    }),
    onSuccess: ({ id, label }) => {
      onCreated(id, label)
      onClose()
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create session',
        description: err?.response?.data?.message ?? err?.message ?? 'Please try again.',
        variant: 'destructive',
      })
    },
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
          {/* Row 1: Date + Purpose */}
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

          {/* Row 2: Source + Format */}
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

          {/* Topics — grouped category/sub-category, draft/apply pattern */}
          <Field label="Topics">
            <button
              type="button"
              onClick={openTopicDropdown}
              className="w-full flex items-center justify-between h-9 px-3 border border-slate-200 rounded-md bg-white text-[13px] hover:border-primary/50 transition-colors"
            >
              <span className={selectedTopics.size === 0 ? 'text-slate-400' : 'text-slate-700'}>
                {selectedTopics.size === 0
                  ? 'No topics selected'
                  : `${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'} selected`}
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
                      <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                        {cat}
                      </p>
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
                        <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                          Uncategorized
                        </p>
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
                  <button type="button" onClick={() => setDraftTopics(new Set())} className="text-[12px] text-slate-400 hover:text-slate-600">
                    Clear all
                  </button>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={cancelTopics}>Cancel</Button>
                    <Button type="button" size="sm" className="h-7 text-[12px] bg-primary hover:bg-primary/90 text-white" onClick={applyTopics}>Apply</Button>
                  </div>
                </div>
              </div>
            )}
          </Field>

          {/* Notes */}
          <Field label="Notes">
            <Textarea rows={2} className="text-[13px] resize-none" placeholder="Optional notes…" value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              type="button" size="sm"
              className="bg-primary hover:bg-primary/90 text-white"
              disabled={!date || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? 'Creating…' : 'Create & Link'}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}

// ── Section 3: Corrective Action & Expectations ───────────────────────────────

export function CorrectiveSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const [showModal, setShowModal]             = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data: linkedSession } = useQuery({
    queryKey: ['cs-detail-for-writeup', form.linked_coaching_id],
    queryFn:  () => trainingService.getCoachingSessionDetail(form.linked_coaching_id!),
    enabled:  (form.linked_coaching_id ?? 0) > 0,
    staleTime: 5 * 60_000,
  })

  const { data: timelineItems = [] } = useQuery({
    queryKey: ['list-items', 'writeup_timeline'],
    queryFn:  () => listService.getItems('writeup_timeline'),
    staleTime: 5 * 60_000,
  })
  const { data: consequenceItems = [] } = useQuery({
    queryKey: ['list-items', 'writeup_consequence'],
    queryFn:  () => listService.getItems('writeup_consequence'),
    staleTime: 5 * 60_000,
  })

  const activeTimelines    = timelineItems.filter(i => i.is_active)
  const activeConsequences = consequenceItems.filter(i => i.is_active)

  // Preserve any legacy free-text value not currently in the list
  const timelineNotInList    = form.correction_timeline && !activeTimelines.some(i => i.label === form.correction_timeline)
  const consequenceNotInList = form.consequence && !activeConsequences.some(i => i.label === form.consequence)

  return (
    <FormSection title="Corrective Action & Expectations">
      <div className="space-y-4">
        <Field label="Required Corrective Action" required>
          <Textarea
            rows={3}
            className="text-[13px] resize-none"
            placeholder="Describe the corrective action required…"
            value={form.corrective_action}
            onChange={e => update('corrective_action', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Timeline for Correction">
            <Select
              value={form.correction_timeline || ''}
              onValueChange={v => update('correction_timeline', v === '__clear__' ? '' : v)}
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue placeholder="Select timeline…" />
              </SelectTrigger>
              <SelectContent>
                {form.correction_timeline && (
                  <SelectItem value="__clear__" className="text-slate-400 italic">— Clear —</SelectItem>
                )}
                {timelineNotInList && (
                  <SelectItem value={form.correction_timeline}>{form.correction_timeline}</SelectItem>
                )}
                {activeTimelines.map(i => (
                  <SelectItem key={i.id} value={i.label}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Consequence if Not Met">
            <Select
              value={form.consequence || ''}
              onValueChange={v => update('consequence', v === '__clear__' ? '' : v)}
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue placeholder="Select consequence…" />
              </SelectTrigger>
              <SelectContent>
                {form.consequence && (
                  <SelectItem value="__clear__" className="text-slate-400 italic">— Clear —</SelectItem>
                )}
                {consequenceNotInList && (
                  <SelectItem value={form.consequence}>{form.consequence}</SelectItem>
                )}
                {activeConsequences.map(i => (
                  <SelectItem key={i.id} value={i.label}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Follow-Up Meeting Date">
            <Input
              type="date"
              className="h-9 text-[13px]"
              value={form.checkin_date}
              onChange={e => update('checkin_date', e.target.value)}
            />
          </Field>
        </div>

        <div>
          <p className="text-[13px] font-medium text-slate-700 mb-2">Linked Coaching Session</p>
          {form.linked_coaching_id ? (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-[13px] table-fixed">
                <colgroup>
                  <col className="w-[80px]" />
                  <col className="w-[130px]" />
                  <col className="w-[160px]" />
                  <col className="w-[150px]" />
                  <col className="w-[160px]" />
                  <col />
                  <col />
                  <col className="w-[120px]" />
                  <col className="w-[64px]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">#</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Purpose</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Format</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Source</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Topics</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Session Date</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-[13px] text-slate-500 font-mono whitespace-nowrap">
                      #{form.linked_coaching_id}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">
                      {linkedSession ? (linkedSession.status ?? '').replace(/_/g, ' ') : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">
                      {linkedSession ? (PURPOSE_LABELS[linkedSession.coaching_purpose] ?? linkedSession.coaching_purpose) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">
                      {linkedSession ? (FORMAT_LABELS[linkedSession.coaching_format] ?? linkedSession.coaching_format?.replace(/_/g, ' ')) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">
                      {linkedSession ? (SOURCE_LABELS[linkedSession.source_type ?? ''] ?? linkedSession.source_type ?? <span className="text-slate-300">&mdash;</span>) : <span className="text-slate-300">&mdash;</span>}
                    </td>

                    {/* Topics — truncated + tooltip bullet list */}
                    <td className="px-3 py-2.5">
                      {linkedSession && (linkedSession.topics ?? []).length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block cursor-default">
                              {linkedSession.topics.join(', ')}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">
                              {linkedSession.topics.map(t => (
                                <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">&mdash;</span>}
                    </td>

                    {/* Notes — truncated + tooltip full text */}
                    <td className="px-3 py-2.5">
                      {linkedSession?.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[13px] text-slate-500 truncate block cursor-default">
                              {linkedSession.notes}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{linkedSession.notes}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">&mdash;</span>}
                    </td>

                    <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
                      {linkedSession?.session_date ? formatQualityDate(linkedSession.session_date) : <span className="text-slate-300">&mdash;</span>}
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <a
                          href={`/app/training/coaching/${form.linked_coaching_id}`}
                          target="_blank" rel="noreferrer"
                          className="text-slate-400 hover:text-primary"
                          title="Open in Training"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                          onClick={() => { update('linked_coaching_id', null); update('linked_coaching_label', '') }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" className="text-[13px]"
                onClick={() => setShowModal(true)}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" /> Link Existing Session
              </Button>
              <Button type="button" variant="outline" size="sm" className="text-[13px]"
                onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Create &amp; Link Session
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        {showModal && (
          <AssignCoachingModal
            csrId={form.csr_id}
            onSelect={(id, label) => { update('linked_coaching_id', id); update('linked_coaching_label', label) }}
            onClose={() => setShowModal(false)}
          />
        )}
      </Dialog>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        {showCreateModal && (
          <CreateCoachingModal
            csrId={form.csr_id}
            onCreated={(id, label) => { update('linked_coaching_id', id); update('linked_coaching_label', label) }}
            onClose={() => setShowCreateModal(false)}
          />
        )}
      </Dialog>
    </FormSection>
  )
}

// ── Section 5: Attachments ────────────────────────────────────────────────────

export function AttachmentsSection({
  form,
  update,
  writeUpId,
}: {
  form: WriteUpFormState
  update: Updater
  writeUpId?: number
}) {
  const [dragging, setDragging]   = useState(false)
  const [deleting, setDeleting]   = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const addFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) return
    update('attachment_files', [...form.attachment_files, ...incoming])
  }, [form.attachment_files, update])

  const removeNewFile = (idx: number) =>
    update('attachment_files', form.attachment_files.filter((_, i) => i !== idx))

  const removeExisting = async (attachmentId: number) => {
    if (!writeUpId) return
    setDeleting(attachmentId)
    try {
      await writeupService.deleteAttachment(writeUpId, attachmentId)
      update('existing_attachments', form.existing_attachments.filter(a => a.id !== attachmentId))
    } catch {
      toast({ title: 'Delete failed', description: 'Could not remove attachment.', variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragging(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <FormSection title="Attachments">
      <Tabs defaultValue="upload">
        <TabsList className="mb-4">
          <TabsTrigger value="upload">Upload Files</TabsTrigger>
          <TabsTrigger value="system">From System Records</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          {/* Existing saved attachments */}
          {form.existing_attachments.length > 0 && (
            <ul className="mb-3 space-y-1">
              {form.existing_attachments.map(a => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                  <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="flex-1 text-[13px] text-slate-700 truncate">{a.filename}</span>
                  {a.file_size && (
                    <span className="text-[11px] text-slate-400">{(a.file_size / 1024).toFixed(0)} KB</span>
                  )}
                  {writeUpId && (
                    <a
                      href={`/api/writeups/${writeUpId}/attachments/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                      title="View / Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                    disabled={deleting === a.id}
                    onClick={() => removeExisting(a.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload files"
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors select-none ${
              dragging
                ? 'border-primary bg-primary/5'
                : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50/50'
            }`}
          >
            <Paperclip className={`h-5 w-5 ${dragging ? 'text-primary' : 'text-slate-400'}`} />
            <span className="text-[13px] text-slate-600 font-medium">
              {dragging ? 'Drop files here' : 'Click to upload or drag and drop'}
            </span>
            <span className="text-[11px] text-slate-400">PDF, DOCX, XLSX, JPG, PNG</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            multiple
            accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
            onChange={e => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />

          {/* Newly queued files (not yet saved) */}
          {form.attachment_files.length > 0 && (
            <ul className="mt-3 space-y-1">
              {form.attachment_files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                  <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="flex-1 text-[13px] text-slate-700 truncate">{f.name}</span>
                  <span className="text-[11px] text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                  <Button type="button" variant="ghost" size="sm"
                    className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                    onClick={() => removeNewFile(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="system" className="mt-0">
          <p className="text-[13px] text-slate-400 py-4 text-center">
            System record attachments will be available after saving the write-up.
          </p>
        </TabsContent>
      </Tabs>
    </FormSection>
  )
}

// ── Section 6: Meeting Notes (edit + DELIVERED only) ─────────────────────────

export function MeetingNotesSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  return (
    <FormSection title="Meeting Notes">
      <Field label="Post-Meeting Notes">
        <Textarea
          rows={4}
          className="text-[13px] resize-none"
          placeholder="Record notes from the meeting…"
          value={form.meeting_notes}
          onChange={e => update('meeting_notes', e.target.value)}
        />
      </Field>
    </FormSection>
  )
}
