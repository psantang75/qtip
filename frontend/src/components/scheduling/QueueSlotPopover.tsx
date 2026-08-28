/**
 * Click a cell on the day board to correct the plan.
 *
 * The checklist pattern is lifted from DayCampaignPopover — tick a queue to put
 * this person on it, untick the one they are on to take them off. What the
 * campaign calendar does not need is a LENGTH: a queue plan is a quarter-hour
 * document, and almost every correction covers a stretch of it ("cover Inbound
 * while Jamie is at lunch"). So the click sets the START, and a dropdown sets how
 * long the adjustment runs — seeded with the block under the cursor, adjustable
 * in fifteen-minute steps, or the whole day.
 *
 * Ticking writes ASSIGN, unticking writes EXCLUDE, and "Back to automatic"
 * deletes both over the SAME window the dropdown describes — a real third state,
 * not a synonym for unticking, and scoped so clearing an hour does not disturb
 * the rest of the day.
 */
import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { PopoverContent } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ApiQueueMeta } from '@/services/phoneQueueService'
import {
  clockLabel, defaultDuration, durationLabel, durationOptions, windowForDuration,
  type DurationChoice, type OverrideRequest, type SlotTarget,
} from './queueDayModel'

export function QueueSlotPopover({ target, queues, canEdit, onApply, onClear }: {
  target: SlotTarget
  queues: ApiQueueMeta[]
  canEdit: boolean
  onApply: (req: OverrideRequest) => void
  onClear: (window: { start: string | null; end: string | null }) => void
}) {
  const [choice, setChoice] = useState<DurationChoice>(() => defaultDuration(target))
  const window_ = windowForDuration(target, choice)
  const options = durationOptions(target)
  const optionsShown = new Set(options)

  const value = choice === 'DAY' ? 'DAY' : String(choice)
  const onSelect = (v: string) => setChoice(v === 'DAY' ? 'DAY' : Number(v))

  const options_ = queues.filter(q => target.memberOf.includes(q.queueId))

  const toggle = (queueId: number, on: boolean) => {
    onApply({
      userId: target.userId,
      queueId,
      action: on ? 'ASSIGN' : 'EXCLUDE',
      start: window_.start,
      end: window_.end,
    })
  }

  return (
    <PopoverContent align="start" side="bottom" className="w-72 p-0">
      <div className="space-y-2 border-b border-slate-100 px-3 py-2">
        <div>
          <p className="text-[13px] font-semibold text-slate-800">{target.username}</p>
          <p className="text-[11px] text-slate-400">
            {window_.start
              ? `${clockLabel(window_.start)} – ${clockLabel(window_.end!)}`
              : 'The whole day'}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium text-slate-500">For</span>
            <Select value={value} onValueChange={onSelect}>
              <SelectTrigger className="h-7 flex-1 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Keep the block length available even if it is not on a 15-min tick. */}
                {typeof choice === 'number' && !optionsShown.has(choice) && (
                  <SelectItem value={String(choice)} className="text-[12px]">{durationLabel(choice)}</SelectItem>
                )}
                {options.map(m => (
                  <SelectItem key={m} value={String(m)} className="text-[12px]">{durationLabel(m)}</SelectItem>
                ))}
                <SelectItem value="DAY" className="text-[12px]">All day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto p-2">
        {options_.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-slate-400">
            {target.username} is not a member of any queue this department staffs.
          </p>
        )}
        {options_.map(q => {
          const on = target.currentQueueId === q.queueId
          return (
            <label key={q.queueId}
              className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                canEdit ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default')}>
              <Checkbox checked={on} disabled={!canEdit} aria-label={q.queueName}
                onCheckedChange={v => canEdit && toggle(q.queueId, v === true)} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: q.color }} />
              <span className={cn('flex-1 truncate', on ? 'text-slate-700' : 'text-slate-500')}>{q.queueName}</span>
            </label>
          )
        })}
      </div>

      {canEdit && (
        <div className="border-t border-slate-100 px-2 py-2">
          <Button variant="ghost" size="sm" onClick={() => onClear(window_)}
            className="h-7 w-full justify-start text-[12px] text-slate-500 hover:text-primary">
            Back to automatic{window_.start ? ' for this time' : ''}
          </Button>
          {target.isOverridden && (
            <p className="px-2 pt-1 text-[11px] text-slate-400">This placement is a manual one.</p>
          )}
        </div>
      )}
    </PopoverContent>
  )
}
