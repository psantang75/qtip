import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ExternalLink, Link2, Paperclip, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

  const csrs = useMemo(
    () => [...(csrsData?.items ?? [])].sort((a, b) => a.username.localeCompare(b.username)),
    [csrsData]
  )

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
              {csrs.map(u => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.username}
                  {u.department_name && (
                    <span className="ml-1 text-slate-400 text-[11px]">· {u.department_name}</span>
                  )}
                </SelectItem>
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
                  type="datetime-local"
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

// ── Assign Coaching Modal ─────────────────────────────────────────────────────

function AssignCoachingModal({ csrId, onSelect, onClose }: {
  csrId: number
  onSelect: (id: number, label: string) => void
  onClose: () => void
}) {
  const { data: sessionData } = useQuery({
    queryKey: ['coaching-sessions-for-csr', csrId],
    queryFn:  () => trainingService.getCoachingSessions({ csr_id: csrId, limit: 50 }),
    enabled:  csrId > 0,
  })
  const sessions = sessionData?.items ?? []

  return (
    <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Link Coaching Session</DialogTitle>
      </DialogHeader>
      <div className="overflow-y-auto flex-1 space-y-1 pr-1">
        {!csrId ? (
          <p className="text-[13px] text-slate-400 py-4 text-center">Select an employee first</p>
        ) : sessions.length === 0 ? (
          <p className="text-[13px] text-slate-400 py-4 text-center">No coaching sessions found</p>
        ) : (
          sessions.map((s: any) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
              onClick={() => { onSelect(s.id, `${s.coaching_purpose ?? 'Session'} — ${formatQualityDate(s.session_date)}`); onClose() }}
            >
              <p className="text-[13px] font-medium text-slate-700">{s.coaching_purpose ?? '—'}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{formatQualityDate(s.session_date)}</p>
            </button>
          ))
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
  const [purpose, setPurpose]   = useState('PERFORMANCE')
  const [format, setFormat]     = useState('ONE_ON_ONE')
  const [date, setDate]         = useState('')
  const [notes, setNotes]       = useState('')

  const createMut = useMutation({
    mutationFn: () => writeupService.createLinkedCoachingSession({
      csr_id:           csrId,
      session_date:     date,
      coaching_purpose: purpose,
      coaching_format:  format,
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
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Create & Link Coaching Session</DialogTitle>
        <DialogDescription className="text-[13px] text-slate-500">
          Creates a new coaching session and automatically links it to this write-up.
          You can add full details in Training after saving.
        </DialogDescription>
      </DialogHeader>

      {!csrId ? (
        <p className="text-[13px] text-slate-400 py-4 text-center">Select an employee first</p>
      ) : (
        <div className="space-y-4 pt-2">
          <Field label="Purpose" required>
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERFORMANCE">Performance Coaching</SelectItem>
                <SelectItem value="WEEKLY">Weekly Coaching</SelectItem>
                <SelectItem value="ONBOARDING">Onboarding Coaching</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Format" required>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ONE_ON_ONE">One-on-One</SelectItem>
                <SelectItem value="SIDE_BY_SIDE">Side-by-Side</SelectItem>
                <SelectItem value="TEAM_SESSION">Team Session</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Planned Session Date" required>
            <Input
              type="date"
              className="h-9 text-[13px]"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              rows={3}
              className="text-[13px] resize-none"
              placeholder="Optional notes for this session…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
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
  const [showModal, setShowModal]       = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

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
            <div className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <Link2 className="h-4 w-4 text-primary shrink-0" />
              <span className="text-[13px] text-slate-700 flex-1">{form.linked_coaching_label}</span>
              <a
                href={`/app/training/coaching/${form.linked_coaching_id}`}
                target="_blank" rel="noreferrer"
                className="text-primary hover:underline"
                title="Open in Training"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button
                type="button" variant="ghost" size="sm"
                className="h-auto w-auto p-0 ml-1 text-slate-400 hover:text-slate-600 hover:bg-transparent"
                onClick={() => { update('linked_coaching_id', null); update('linked_coaching_label', '') }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
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
        <AssignCoachingModal
          csrId={form.csr_id}
          onSelect={(id, label) => { update('linked_coaching_id', id); update('linked_coaching_label', label) }}
          onClose={() => setShowModal(false)}
        />
      </Dialog>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <CreateCoachingModal
          csrId={form.csr_id}
          onCreated={(id, label) => { update('linked_coaching_id', id); update('linked_coaching_label', label) }}
          onClose={() => setShowCreateModal(false)}
        />
      </Dialog>
    </FormSection>
  )
}

// ── Section 5: Attachments ────────────────────────────────────────────────────

export function AttachmentsSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const removeFile = (idx: number) =>
    update('attachment_files', form.attachment_files.filter((_, i) => i !== idx))

  return (
    <FormSection title="Attachments">
      <Tabs defaultValue="upload">
        <TabsList className="mb-4">
          <TabsTrigger value="upload">Upload Files</TabsTrigger>
          <TabsTrigger value="system">From System Records</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-lg p-6 cursor-pointer hover:border-primary/40 transition-colors">
            <Paperclip className="h-5 w-5 text-slate-400" />
            <span className="text-[13px] text-slate-500">Click to upload files</span>
            <span className="text-[11px] text-slate-400">PDF, DOCX, XLSX, JPG, PNG</span>
            <input
              type="file" className="sr-only" multiple
              accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
              onChange={e => {
                const files = Array.from(e.target.files ?? [])
                update('attachment_files', [...form.attachment_files, ...files])
                e.target.value = ''
              }}
            />
          </label>
          {form.attachment_files.length > 0 && (
            <ul className="mt-3 space-y-1">
              {form.attachment_files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                  <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="flex-1 text-[13px] text-slate-700 truncate">{f.name}</span>
                  <span className="text-[11px] text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                  <Button type="button" variant="ghost" size="sm"
                    className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                    onClick={() => removeFile(i)}>
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
