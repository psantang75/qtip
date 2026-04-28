import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Ticket, Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import crmService, {
  type TicketTaskKind,
  type TaskHeader,
  type TicketHeader,
  type CRMNote,
} from '@/services/crmService'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'

/**
 * Linked CRM ticket/task selector. Mirrors the structural pattern of
 * `MultipleCallSelector.tsx`:
 *   - tabs across the top when more than one is linked
 *   - dashed-border "add" form with inline validation
 *   - Add / Cancel / Remove buttons
 *
 * Persistence is reference-only — the parent component holds a list of
 * { kind, external_id } pairs in state and submits them with the
 * submission payload. Header + notes are live-fetched from the CRM via
 * `crmService` for the active tab; nothing else is cached.
 *
 * `auditAt` (optional) is the submission's `submitted_at` used to split
 * notes into "At time of audit" vs "Activity since audit" sections in
 * the read-only view. On the audit form (no submission yet) it's left
 * undefined and the split is suppressed.
 */
export interface TicketTaskRef {
  kind: TicketTaskKind
  external_id: number
}

interface TicketTaskSelectorProps {
  selected: TicketTaskRef[]
  onChange: (next: TicketTaskRef[]) => void
  /** Audit submission timestamp; enables the before/after note split. */
  auditAt?: string | null
  /** Read-only mode used by the submission detail panel. */
  readOnly?: boolean
  disabled?: boolean
}

export default function TicketTaskSelector({
  selected,
  onChange,
  auditAt,
  readOnly = false,
  disabled = false,
}: TicketTaskSelectorProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [adding,      setAdding]      = useState(false)
  const [kind,        setKind]        = useState<TicketTaskKind>('TASK')
  const [idText,      setIdText]      = useState('')
  const [error,       setError]       = useState('')

  const active = selected[activeIndex] ?? null

  const headerQuery = useQuery({
    queryKey: ['crm-header', active?.kind, active?.external_id],
    enabled: !!active,
    queryFn: () =>
      active!.kind === 'TASK'
        ? crmService.getTaskHeader(active!.external_id)
        : crmService.getTicketHeader(active!.external_id),
  })

  const notesQuery = useQuery({
    queryKey: ['crm-notes', active?.kind, active?.external_id, auditAt ?? null],
    enabled: !!active,
    queryFn: () =>
      active!.kind === 'TASK'
        ? crmService.getTaskNotes(active!.external_id, auditAt)
        : crmService.getTicketNotes(active!.external_id, auditAt),
  })

  const handleAdd = async () => {
    setError('')
    const trimmed = idText.trim()
    if (!trimmed) {
      setError(`${kind === 'TASK' ? 'Task' : 'Ticket'} ID is required.`)
      return
    }
    if (!/^\d+$/.test(trimmed)) {
      setError('ID must be digits only.')
      return
    }
    const id = Number(trimmed)
    if (!Number.isInteger(id) || id <= 0) {
      setError('ID must be a positive integer.')
      return
    }
    if (selected.some((s) => s.kind === kind && s.external_id === id)) {
      setError('That ticket/task is already added.')
      return
    }

    // Verify it exists on the CRM before linking. This catches typos
    // immediately rather than waiting until the audit submit fails.
    try {
      const exists =
        kind === 'TASK'
          ? await crmService.getTaskHeader(id)
          : await crmService.getTicketHeader(id)
      if (!exists) {
        setError(`${kind === 'TASK' ? 'Task' : 'Ticket'} ${id} not found in CRM.`)
        return
      }
    } catch {
      setError('Could not reach CRM. Try again.')
      return
    }

    const next = [...selected, { kind, external_id: id }]
    onChange(next)
    setActiveIndex(next.length - 1)
    setAdding(false)
    setIdText('')
    setError('')
  }

  const handleCancel = () => {
    setAdding(false)
    setIdText('')
    setError('')
  }

  const removeActive = () => {
    if (active === null) return
    const next = selected.filter((_, i) => i !== activeIndex)
    onChange(next)
    setActiveIndex(Math.max(0, Math.min(activeIndex, next.length - 1)))
  }

  const splitNotes = useMemo(() => {
    const all: CRMNote[] = notesQuery.data ?? []
    return {
      before: all.filter((n) => !n.is_after_audit),
      after: all.filter((n) => n.is_after_audit),
    }
  }, [notesQuery.data])

  return (
    <div className="space-y-0">
      {/* Tabs row — shown when >1 linked */}
      {selected.length > 1 && (
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {selected.map((s, i) => (
            <button
              key={`${s.kind}-${s.external_id}`}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors whitespace-nowrap',
                activeIndex === i
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {s.kind === 'TASK' ? <ClipboardList className="h-3 w-3" /> : <Ticket className="h-3 w-3" />}
              {s.kind === 'TASK' ? 'Task' : 'Ticket'} {s.external_id}
            </button>
          ))}
        </div>
      )}

      {/* Active row detail */}
      {active && (
        <div className="space-y-3 py-3">
          <ActiveHeader kind={active.kind} headerQuery={headerQuery} />

          {!readOnly && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 gap-1"
                onClick={removeActive}
                disabled={disabled}
              >
                <X className="h-3 w-3" /> Remove {active.kind === 'TASK' ? 'task' : 'ticket'}
              </Button>
            </div>
          )}

          {notesQuery.isLoading && (
            <p className="text-[12px] text-slate-400">Loading notes…</p>
          )}
          {notesQuery.isError && (
            <p className="text-[12px] text-red-600">Failed to load notes.</p>
          )}
          {notesQuery.data && (
            <>
              {auditAt && splitNotes.before.length === 0 && splitNotes.after.length === 0 && (
                <p className="text-[12px] text-slate-400">No notes for this {active.kind === 'TASK' ? 'task' : 'ticket'}.</p>
              )}

              {!auditAt && splitNotes.before.length === 0 && (
                <p className="text-[12px] text-slate-400">No notes for this {active.kind === 'TASK' ? 'task' : 'ticket'}.</p>
              )}

              {auditAt ? (
                <>
                  {splitNotes.before.length > 0 && (
                    <NotesSection title="At time of audit" notes={splitNotes.before} />
                  )}
                  {splitNotes.after.length > 0 && (
                    <NotesSection title="Activity since audit" notes={splitNotes.after} muted />
                  )}
                </>
              ) : (
                splitNotes.before.length > 0 && <NotesSection notes={splitNotes.before} />
              )}
            </>
          )}
        </div>
      )}

      {!readOnly && (
        adding ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 space-y-2 mt-2">
            <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Type</label>
                <div className="flex items-center gap-3 h-9">
                  <label className="flex items-center gap-1.5 text-[12px] text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="ticket-task-kind"
                      value="TICKET"
                      checked={kind === 'TICKET'}
                      onChange={() => setKind('TICKET')}
                      className="accent-primary"
                    />
                    Ticket
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="ticket-task-kind"
                      value="TASK"
                      checked={kind === 'TASK'}
                      onChange={() => setKind('TASK')}
                      className="accent-primary"
                    />
                    Task
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  {kind === 'TASK' ? 'Task' : 'Ticket'} ID
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 1071649"
                  value={idText}
                  onChange={(e) => setIdText(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="h-9 text-[13px]"
                  autoFocus
                />
              </div>
            </div>
            {error && <p className="text-[12px] text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-primary hover:bg-primary/90 text-white"
                onClick={handleAdd}
              >
                Add
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-[12px] text-slate-600 gap-1.5 mt-2"
            onClick={() => setAdding(true)}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" /> Add Ticket / Task
          </Button>
        )
      )}

      {!active && !adding && readOnly && (
        <p className="text-[12px] text-slate-400 italic">No tickets or tasks linked.</p>
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────

function ActiveHeader({
  kind,
  headerQuery,
}: {
  kind: TicketTaskKind
  headerQuery: ReturnType<typeof useQuery<TaskHeader | TicketHeader | null>>
}) {
  if (headerQuery.isLoading) {
    return <p className="text-[12px] text-slate-400">Loading…</p>
  }
  if (headerQuery.isError) {
    return <p className="text-[12px] text-red-600">Failed to load CRM data.</p>
  }
  const data = headerQuery.data
  if (!data) {
    return <p className="text-[12px] text-amber-600">{kind === 'TASK' ? 'Task' : 'Ticket'} no longer exists in CRM.</p>
  }

  if (kind === 'TASK') {
    const t = data as TaskHeader
    return (
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        <Field label="Task Type"   value={t.task_type} />
        <Field label="Task Status" value={t.task_status} />
        <Field label="Assigned To" value={t.assigned_to_name ?? (t.assigned_to_id ? `User #${t.assigned_to_id}` : null)} />
      </div>
    )
  }

  const t = data as TicketHeader
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
      <Field label="Class"       value={t.class_name} />
      <Field label="Subclass"    value={t.subclass_name} />
      <Field label="Status"      value={t.status} />
      <Field label="Assigned To" value={t.assigned_to_name ?? (t.assigned_to_id ? `User #${t.assigned_to_id}` : null)} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[12px] font-medium text-slate-700 mt-0.5 break-words">{value ?? '—'}</p>
    </div>
  )
}

function NotesSection({ title, notes, muted = false }: { title?: string; notes: CRMNote[]; muted?: boolean }) {
  return (
    <div>
      {title && (
        <p className={cn(
          'text-[11px] font-semibold uppercase tracking-wide mb-2',
          muted ? 'text-amber-600' : 'text-slate-500'
        )}>
          {title}
          <span className="ml-1.5 text-[10px] font-normal text-slate-400 normal-case">
            ({notes.length} {notes.length === 1 ? 'note' : 'notes'})
          </span>
        </p>
      )}
      <div className="space-y-2">
        {notes.map((n) => (
          <NoteRow key={n.id} note={n} />
        ))}
      </div>
    </div>
  )
}

function NoteRow({ note }: { note: CRMNote }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[12px]">
      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-slate-700 break-words">
            {note.created_by_name ?? (note.created_by ? `User #${note.created_by}` : 'Unknown')}
          </span>
          {note.created_on && <span>· {fmtDate(note.created_on)}</span>}
        </div>
        {(note.status_after || note.next_contact_date) && (
          <div className="flex items-center gap-2 shrink-0">
            {note.status_after && (
              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium">
                → {note.status_after}
              </span>
            )}
            {note.next_contact_date && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium">
                Next: {note.next_contact_date}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="text-slate-700 whitespace-pre-wrap break-words leading-snug">
        {note.note}
      </div>
    </div>
  )
}
