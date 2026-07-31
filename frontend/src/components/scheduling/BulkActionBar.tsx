/**
 * MOCKUP — Phase 1 design probe only.
 *
 * Bulk actions act on the checked rows, so a mixed week — five agents carried
 * forward, two moved onto a different template — is two passes over the same
 * grid rather than fourteen individual edits.
 *
 * The bar names the range it is about to build, so "Copy a Prior Week" can
 * never be read as copying the week on screen. When that range is already
 * published the actions switch off entirely and say why, because rebuilding a
 * whole range at once is only safe while it is still a draft.
 */
import { CalendarCheck, CalendarPlus, CalendarX, Copy, Lock, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApplyMode } from './ApplyScheduleDialog'

interface Props {
  selectedCount: number
  visibleCount: number
  rangeLabel: string
  /** Non-null when the displayed range is published, and therefore off limits
   *  to schedule writes. Exceptions are unaffected. */
  blockedReason: string | null
  onClear: () => void
  onStart: (mode: ApplyMode) => void
  onAddException: () => void
  /** Publish the checked rows across the displayed range. */
  onPublish?: () => void
  /** True when the displayed range still holds drafts worth publishing. */
  canPublish?: boolean
  publishing?: boolean
}

export function BulkActionBar({
  selectedCount, visibleCount, rangeLabel, blockedReason, onClear, onStart, onAddException,
  onPublish, canPublish, publishing,
}: Props) {
  const hasSelection = selectedCount > 0

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2',
      hasSelection && !blockedReason
        ? 'border-primary/30 bg-primary/[0.04]'
        : 'border-slate-200 bg-slate-50',
    )}>
      <span className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
        {blockedReason ? (
          <>
            <Lock className="h-3.5 w-3.5 text-slate-400" />
            {blockedReason}
          </>
        ) : hasSelection ? (
          <>
            <span className="font-semibold text-neutral-900">{selectedCount}</span>
            {' '}of {visibleCount} selected &middot; building{' '}
            <span className="tabular-nums">{rangeLabel}</span>
          </>
        ) : (
          'Check employees to build their schedule or log an exception.'
        )}
      </span>

      {hasSelection && !blockedReason && (
        <Button
          variant="ghost" size="sm"
          className="h-7 px-2 text-[12px] text-slate-500"
          onClick={onClear}
        >
          <X className="mr-1 h-3.5 w-3.5" /> Clear
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Exceptions stay available on a locked range — logging that someone
            was late last Tuesday is exactly the published, elapsed case. */}
        <Button variant="outline" size="sm" disabled={!hasSelection} onClick={onAddException}>
          <CalendarX className="mr-1 h-4 w-4" /> Add Exception
        </Button>
        <Button
          variant="outline" size="sm"
          disabled={!hasSelection || !!blockedReason}
          onClick={() => onStart('copy')}
        >
          <Copy className="mr-1 h-4 w-4" /> Copy a Prior Week
        </Button>
        <Button
          variant="outline" size="sm"
          disabled={!hasSelection || !!blockedReason}
          onClick={() => onStart('template')}
        >
          <CalendarPlus className="mr-1 h-4 w-4" /> Apply Template
        </Button>
        {onPublish && (
          <Button
            variant="primary" size="sm"
            disabled={!hasSelection || !canPublish || publishing}
            onClick={onPublish}
          >
            <CalendarCheck className="mr-1 h-4 w-4" /> {publishing ? 'Publishing\u2026' : 'Publish'}
          </Button>
        )}
      </div>
    </div>
  )
}
