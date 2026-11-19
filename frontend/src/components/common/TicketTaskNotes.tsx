import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TicketTaskKind, CRMNote, CRMCallActivity } from '@/services/crmService'
import { formatCrmDateTime } from '@/utils/dateFormat'
import {
  buildTimeline,
  callAgentLabel,
  callSummary,
  timelineCountLabel,
  type TimelineEntry,
} from '@/utils/crmTimeline'
import { RichTextDisplay } from '@/components/common/RichTextDisplay'

/**
 * Collapsible activity list for the active linked ticket/task: CRM notes and
 * logged phone calls (with their wrap-up) interleaved newest first, split into
 * "Activity since audit" / "At time of audit" when `auditAt` is set.
 */
interface TicketTaskNotesProps {
  kind: TicketTaskKind
  notes: CRMNote[] | undefined
  calls: CRMCallActivity[] | undefined
  loading: boolean
  notesError: boolean
  callsError: boolean
  auditAt?: string | null
}

export default function TicketTaskNotes({
  kind,
  notes,
  calls,
  loading,
  notesError,
  callsError,
  auditAt,
}: TicketTaskNotesProps) {
  const [open, setOpen] = useState(false)

  const entries = useMemo(() => buildTimeline(notes ?? [], calls ?? []), [notes, calls])
  const split = useMemo(() => ({
    before: entries.filter((e) => !e.isAfterAudit),
    after: entries.filter((e) => e.isAfterAudit),
  }), [entries])

  if (loading) {
    return <p className="text-[12px] text-slate-400">Loading notes…</p>
  }

  return (
    <>
      {notesError && <p className="text-[12px] text-red-600">Couldn't load notes.</p>}
      {callsError && <p className="text-[12px] text-red-600">Couldn't load call activity.</p>}

      {entries.length === 0 ? (
        !notesError && !callsError && (
          <p className="text-[12px] text-slate-400">
            No notes for this {kind === 'TASK' ? 'task' : 'ticket'}.
          </p>
        )
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between py-2 px-3 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-slate-700">
                {open ? 'Hide' : 'Show'} Notes
              </span>
              <span className="text-[11px] text-slate-400">{timelineCountLabel(entries)}</span>
            </div>
            {open
              ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
          </button>

          {open && (
            <div className="mt-2 space-y-3">
              {auditAt ? (
                <>
                  {split.after.length > 0 && (
                    <TimelineSection title="Activity since audit" entries={split.after} muted />
                  )}
                  {split.before.length > 0 && (
                    <TimelineSection title="At time of audit" entries={split.before} />
                  )}
                </>
              ) : (
                <TimelineSection entries={entries} />
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function TimelineSection({ title, entries, muted = false }: { title?: string; entries: TimelineEntry[]; muted?: boolean }) {
  return (
    <div>
      {title && (
        <p className={cn(
          'text-[11px] font-semibold uppercase tracking-wide mb-2',
          muted ? 'text-amber-600' : 'text-slate-500'
        )}>
          {title}
          <span className="ml-1.5 text-[10px] font-normal text-slate-400 normal-case">
            {timelineCountLabel(entries)}
          </span>
        </p>
      )}
      <div className="space-y-2">
        {entries.map((e) => (e.kind === 'call'
          ? <CallRow key={e.key} call={e.call} />
          : <NoteRow key={e.key} note={e.note} />))}
      </div>
    </div>
  )
}

function RowHeader({ author, at, icon, children }: {
  author: string
  at: string | null
  icon?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-100 border-b border-slate-200">
      <div className="flex items-center gap-2 min-w-0 text-[11px] text-slate-600">
        {icon}
        <span className="font-semibold text-slate-800 break-words">{author}</span>
        {at && <span className="text-slate-500">· {formatCrmDateTime(at)}</span>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}

function NoteRow({ note }: { note: CRMNote }) {
  const hasBody = (note.note ?? '').trim().length > 0

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[12px]">
      <RowHeader
        author={note.created_by_name ?? (note.created_by ? `User #${note.created_by}` : 'Unknown')}
        at={note.created_on}
      >
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
      </RowHeader>
      {hasBody && (
        <RichTextDisplay html={note.note} className="px-3 py-2.5 text-[12px]" />
      )}
    </div>
  )
}

function CallRow({ call }: { call: CRMCallActivity }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[12px]">
      <RowHeader
        author={callAgentLabel(call)}
        at={call.occurred_on}
        icon={<Phone className="h-3 w-3 shrink-0 text-slate-500" />}
      />
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[12px] text-slate-700 break-words">{callSummary(call)}</p>
        {call.wrap_up && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Call Wrap-Up</p>
            <RichTextDisplay html={call.wrap_up} className="mt-0.5 text-[12px]" />
          </div>
        )}
      </div>
    </div>
  )
}
