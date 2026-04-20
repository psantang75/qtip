import { Pencil } from 'lucide-react'
import { ListItemReadOnly, NoteBlock } from './DetailLayout'

export interface InternalListItem {
  id: number
  category?: string | null
  label: string
  sort_order?: number
}

interface InternalNotesPanelProps {
  internalNotes?: string | null
  behaviorFlagItems?: InternalListItem[]
  rootCauseItems?: InternalListItem[]
  supportNeededItems?: InternalListItem[]
  legacyRootCauseText?: string | null
  legacySupportNeededText?: string | null
  canEdit?: boolean
  onEdit?: () => void
}

/**
 * Shared read-only "Internal Notes" panel used by Coaching and Performance Warning
 * detail pages. Shows the management-only Private badge and renders three list
 * categories (Root Cause, Support Needed, Behavior Flags) plus a free-form note.
 */
export function InternalNotesPanel({
  internalNotes,
  behaviorFlagItems,
  rootCauseItems,
  supportNeededItems,
  legacyRootCauseText,
  legacySupportNeededText,
  canEdit,
  onEdit,
}: InternalNotesPanelProps) {
  const normalize = (items?: InternalListItem[]) =>
    items?.map(i => ({ ...i, category: i.category ?? undefined })) ?? []

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-slate-800">Internal Notes</h3>
          <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            Private — Not visible to Agent
          </span>
        </div>
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-slate-400 hover:text-primary transition-colors text-[12px]"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <div className="space-y-5">
            <ListItemReadOnly
              label="Root Cause"
              items={normalize(rootCauseItems)}
              legacyText={legacyRootCauseText ?? undefined}
            />
            <ListItemReadOnly
              label="Support Needed"
              items={normalize(supportNeededItems)}
              legacyText={legacySupportNeededText ?? undefined}
            />
          </div>
          <ListItemReadOnly label="Behavior Flags" items={normalize(behaviorFlagItems)} />
        </div>
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Internal Notes
          </p>
          <NoteBlock text={internalNotes} placeholder="No internal notes recorded" bold />
        </div>
      </div>
    </div>
  )
}

export default InternalNotesPanel
