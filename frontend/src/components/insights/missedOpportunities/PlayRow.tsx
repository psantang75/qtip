/**
 * One mined sales play in the admin review list. Presentational: the parent owns
 * the query + mutation and passes `onUpdate`. Actions are the status lifecycle —
 * approve a proposed play, archive an active one, restore an archived one — so an
 * admin curates which plays ground the review without editing prompt text here.
 */
import { Check, Archive, RotateCcw, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { SalesPlay, UpdatePlayInput } from '@/types/salesPlays'

interface PlayRowProps {
  play: SalesPlay
  canEdit: boolean
  saving: boolean
  onUpdate: (playId: number, patch: UpdatePlayInput) => void
}

const statusCls = (status: string) =>
  cn(
    'text-[10px] uppercase tracking-wide',
    status === 'active'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'proposed'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-slate-200 bg-slate-50 text-slate-400',
  )

export default function PlayRow({ play, canEdit, saving, onUpdate }: PlayRowProps) {
  const isWon = play.sourceOutcome === 'WON'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-slate-600">
          {play.category}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] uppercase tracking-wide',
            isWon ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger',
          )}
        >
          {play.sourceOutcome}
        </Badge>
        <Badge variant="outline" className={statusCls(play.status)}>
          {play.status}
        </Badge>
        {play.supportCount != null && play.supportCount > 1 && (
          <Badge
            variant="outline"
            className="gap-1 border-primary/40 bg-primary/10 text-[10px] uppercase tracking-wide text-primary"
          >
            <Layers className="h-3 w-3" /> proven in {play.supportCount} calls
          </Badge>
        )}
        {play.sourceAgentName && (
          <span className="text-[11px] text-slate-400">from {play.sourceAgentName}</span>
        )}
      </div>

      <p className="mt-2 text-[13px] font-semibold text-slate-900">{play.title}</p>
      <p className="mt-0.5 text-[12.5px] text-slate-600">{play.bodyMd}</p>

      {play.evidenceQuote && (
        <p className="mt-1.5 border-l-2 border-slate-200 pl-2 text-[12px] italic text-slate-500">
          {play.evidenceSpeaker ? `${play.evidenceSpeaker}: ` : ''}“{play.evidenceQuote}”
        </p>
      )}
      {play.estValueNote && (
        <p className="mt-1 text-[11px] text-slate-400">Value: {play.estValueNote}</p>
      )}

      {canEdit && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {play.status !== 'active' && (
            <Button
              size="sm" variant="outline" disabled={saving}
              onClick={() => onUpdate(play.playId, { status: 'active' })}
              className="h-7 text-[12px]"
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Approve
            </Button>
          )}
          {play.status !== 'archived' && (
            <Button
              size="sm" variant="outline" disabled={saving}
              onClick={() => onUpdate(play.playId, { status: 'archived' })}
              className="h-7 text-[12px]"
            >
              <Archive className="mr-1 h-3.5 w-3.5" /> Archive
            </Button>
          )}
          {play.status === 'archived' && (
            <Button
              size="sm" variant="outline" disabled={saving}
              onClick={() => onUpdate(play.playId, { status: 'proposed' })}
              className="h-7 text-[12px]"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
