import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Ticket, Plus, X, ExternalLink } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import crmService, {
  type TicketTaskKind,
  type TaskHeader,
  type TicketHeader,
} from '@/services/crmService'
import { buildCrmTaskUrl, buildCrmTicketUrl } from '@/utils/crmLinks'
import TicketTaskNotes from '@/components/common/TicketTaskNotes'

/**
 * Linked CRM ticket/task selector. Mirrors the structural pattern of
 * `MultipleCallSelector.tsx`:
 *   - tabs across the top when more than one is linked
 *   - dashed-border "add" form with inline validation
 *   - Add / Cancel / Remove buttons
 *
 * Persistence is reference-only — the parent component holds a list of
 * { kind, external_id } pairs in state and submits them with the
 * submission payload. Header, notes and logged phone calls are live-fetched
 * from the CRM via `crmService` for the active tab; nothing else is cached.
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

  const headerQuery = useQuery<TaskHeader | TicketHeader | null>({
    queryKey: ['crm-header', active?.kind, active?.external_id],
    enabled: !!active,
    queryFn: async (): Promise<TaskHeader | TicketHeader | null> =>
      active!.kind === 'TASK'
        ? await crmService.getTaskHeader(active!.external_id)
        : await crmService.getTicketHeader(active!.external_id),
  })

  const notesQuery = useQuery({
    queryKey: ['crm-notes', active?.kind, active?.external_id, auditAt ?? null],
    enabled: !!active,
    queryFn: () =>
      active!.kind === 'TASK'
        ? crmService.getTaskNotes(active!.external_id, auditAt)
        : crmService.getTicketNotes(active!.external_id, auditAt),
  })

  const callsQuery = useQuery({
    queryKey: ['crm-calls', active?.kind, active?.external_id, auditAt ?? null],
    enabled: !!active,
    queryFn: () => crmService.getCallActivity(active!.kind, active!.external_id, auditAt),
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
      setError("We can't reach the CRM. Try again.")
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
          <ActiveHeader kind={active.kind} externalId={active.external_id} headerQuery={headerQuery} />

          <TicketTaskNotes
            kind={active.kind}
            notes={notesQuery.data}
            calls={callsQuery.data}
            loading={notesQuery.isLoading || callsQuery.isLoading}
            notesError={notesQuery.isError}
            callsError={callsQuery.isError}
            auditAt={auditAt}
          />

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
        </div>
      )}

      {!readOnly && (
        adding ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 space-y-2 mt-2">
            <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Type</label>
                <div className="flex items-center gap-1.5 h-9">
                  {(['TICKET', 'TASK'] as const).map((opt) => {
                    const selected = kind === opt
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setKind(opt)}
                        className={cn(
                          'h-7 px-3 text-[12px] rounded border font-medium transition-all',
                          selected
                            ? 'bg-[#00aeef] text-white border-[#00aeef]'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]',
                        )}
                      >
                        {opt === 'TICKET' ? 'Ticket' : 'Task'}
                      </button>
                    )
                  })}
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
  externalId,
  headerQuery,
}: {
  kind: TicketTaskKind
  externalId: number
  headerQuery: ReturnType<typeof useQuery<TaskHeader | TicketHeader | null>>
}) {
  if (headerQuery.isLoading) {
    return <p className="text-[12px] text-slate-400">Loading…</p>
  }
  if (headerQuery.isError) {
    return <p className="text-[12px] text-red-600">Couldn't load CRM data.</p>
  }
  const data = headerQuery.data
  if (!data) {
    return <p className="text-[12px] text-amber-600">{kind === 'TASK' ? 'Task' : 'Ticket'} no longer exists in CRM.</p>
  }

  const idLabel = kind === 'TASK' ? 'Task #' : 'Ticket #'
  // The task layout segment comes from the task type's NewScreen (carried on the
  // header), so a Contact Manager / Lead Manager / Job task links to the right
  // CRM screen instead of the old hardcoded AccountsReceivableManager.
  const crmHref = kind === 'TASK'
    ? buildCrmTaskUrl({
        taskId: externalId,
        newScreen: (data as TaskHeader).new_screen,
        taskTypeId: (data as TaskHeader).task_type_id,
        jobId: (data as TaskHeader).job_id,
      })
    : buildCrmTicketUrl(externalId)
  const idLink = (
    <a
      href={crmHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:text-primary/80 hover:underline break-all"
    >
      {externalId}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  )

  if (kind === 'TASK') {
    const t = data as TaskHeader
    return (
      <div className="flex flex-wrap gap-x-12 gap-y-3">
        <FieldNode label={idLabel}>{idLink}</FieldNode>
        <Field label="Task Type"   value={t.task_type} />
        <Field label="Task Status" value={t.task_status} />
        <Field label="Assigned To" value={t.assigned_to_name ?? (t.assigned_to_id ? `User #${t.assigned_to_id}` : null)} />
      </div>
    )
  }

  const t = data as TicketHeader
  // Layout per request:
  //   1) Ticket # | Assigned To | Status
  //   2) Description (full width)
  //   3) Subclass | Resolution
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-12 gap-y-3">
        <FieldNode label={idLabel}>{idLink}</FieldNode>
        <Field label="Assigned To" value={t.assigned_to_name ?? (t.assigned_to_id ? `User #${t.assigned_to_id}` : null)} />
        <Field label="Status"      value={t.status} />
      </div>
      <LongField label="Description" value={t.description} />
      <div className="flex flex-wrap gap-x-12 gap-y-3">
        <Field      label="Subclass"   value={t.subclass_name} />
        <LongField  label="Resolution" value={t.resolution} className="flex-1 min-w-[240px]" />
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <FieldNode label={label}>
      <p className="text-[12px] font-medium text-slate-700 mt-0.5 break-words">{value ?? '—'}</p>
    </FieldNode>
  )
}

function FieldNode({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-shrink">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

/**
 * Variant of `Field` for long-form text (description, resolution).
 * Wraps onto its own row, preserves line breaks, and falls back to an
 * em-dash so empty values still render the label for visual stability.
 */
function LongField({ label, value, className }: { label: string; value: string | null; className?: string }) {
  const clean = (value ?? '').trim()
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[12px] text-slate-700 mt-0.5 whitespace-pre-wrap break-words leading-snug">
        {clean ? clean : <span className="text-slate-400">—</span>}
      </p>
    </div>
  )
}
