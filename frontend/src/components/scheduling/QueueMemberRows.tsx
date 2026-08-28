/**
 * Who may staff ONE queue, as a block that expands underneath that queue's row
 * in the settings sheet.
 *
 * It used to be a separate dialog reached from a dropdown on the page header,
 * which meant a queue's numbers and the people who can meet them were two
 * different journeys. They are one decision, so they are now one surface with
 * one Save; this component is only the rows.
 *
 * Priority ascends — 1 is pulled into a higher-priority queue before 2 — the
 * same direction as the queue fill order, so there is only one rule to remember.
 */
import { Home, Pin } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface MemberDraft {
  member: boolean
  is_home: boolean
  person_priority: number
  is_pinned: boolean
}

const GRID = 'grid grid-cols-[3rem_1fr_5rem_3rem_3rem] items-center gap-2'
const num = 'h-8 w-16 rounded-md border border-slate-200 bg-white px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40'

export function QueueMemberRows({ people, draft, onPatch, homeQueueNameOf }: {
  people: Array<{ user_id: number; username: string }>
  /** Keyed by user id. */
  draft: Record<number, MemberDraft>
  onPatch: (userId: number, next: Partial<MemberDraft>) => void
  /** The queue a person sits on by default, when it is not this one. */
  homeQueueNameOf: (userId: number) => string | null
}) {
  if (people.length === 0) {
    return (
      <div className="p-6 text-center text-[12.5px] text-slate-400">
        Nobody is assigned to this department yet.
      </div>
    )
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/60">
      <div className={cn(GRID, 'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500')}>
        <span>Takes</span>
        <span>Person</span>
        <span title="Lower is pulled in first">Priority</span>
        <span title="Where they sit by default">Home</span>
        <span title="Never moved off this queue">Pin</span>
      </div>

      {people.map(p => {
        const d = draft[p.user_id]
        if (!d) return null
        const elsewhere = homeQueueNameOf(p.user_id)
        return (
          <div key={p.user_id} className={cn(GRID, 'px-3 py-1.5', !d.member && 'opacity-45')}>
            <Switch checked={d.member} className="scale-75"
              onCheckedChange={v => onPatch(p.user_id, v ? { member: true } : { member: false, is_home: false, is_pinned: false })} />

            <span className="truncate text-[13px] text-slate-700">
              {p.username}
              {/* A person has exactly one home queue, so knowing where they
                  currently sit is what makes the Home button a safe click. */}
              {d.member && !d.is_home && elsewhere && (
                <span className="ml-2 text-[11px] text-slate-400">sits on {elsewhere}</span>
              )}
            </span>

            <input type="number" className={num} min={1} max={999} value={d.person_priority} disabled={!d.member}
              onChange={e => onPatch(p.user_id, { person_priority: Math.max(1, Number(e.target.value) || 1) })} />

            <Button type="button" variant="ghost" size="sm" disabled={!d.member}
              onClick={() => onPatch(p.user_id, { is_home: !d.is_home })}
              title={d.is_home ? 'Their home queue' : 'Make this their home queue'}
              className={cn('h-8 w-8 p-0', d.is_home ? 'text-primary' : 'text-slate-300 hover:text-slate-500')}>
              <Home className="h-4 w-4" />
            </Button>

            <Button type="button" variant="ghost" size="sm" disabled={!d.member}
              onClick={() => onPatch(p.user_id, { is_pinned: !d.is_pinned })}
              title={d.is_pinned ? 'Pinned here — never moved' : 'Pin them here'}
              className={cn('h-8 w-8 p-0', d.is_pinned ? 'text-primary' : 'text-slate-300 hover:text-slate-500')}>
              <Pin className="h-4 w-4" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
