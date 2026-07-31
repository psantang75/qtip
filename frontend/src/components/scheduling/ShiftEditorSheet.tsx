/**
 * MOCKUP — Phase 1 design probe only.
 *
 * Editing one person's day: shift start and end plus up to three break or
 * lunch pairs. It is a drawer rather than an inline cell edit because seven
 * times will not fit in a grid cell at any column width we can afford.
 *
 * Local state only — Save closes the sheet and changes nothing.
 */
import { useEffect, useState } from 'react'
import { Plus, Trash2, Coffee, UtensilsCrossed } from 'lucide-react'

import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { MockBreak, MockException, MockShift } from './mockScheduleData'
import { parseLocal } from './mockScheduleData'
import { fmtHours, minutesOf, paidMinutes } from './scheduleTime'
import { ExceptionEditor } from './ExceptionEditor'

const MAX_BREAKS = 3

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  personName?: string
  date?: string
  shift?: MockShift
  exceptions?: MockException[]
  /** Commit handler. When absent the sheet is inert (mockup). */
  onSave?: (payload: { start: string; end: string; breaks: MockBreak[] }) => Promise<void> | void
  onDelete?: () => Promise<void> | void
  saving?: boolean
}

export function ShiftEditorSheet({
  open, onOpenChange, personName, date, shift, exceptions = [], onSave, onDelete, saving,
}: Props) {
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('17:00')
  const [breaks, setBreaks] = useState<MockBreak[]>([])
  const [exs, setExs] = useState<MockException[]>([])

  // Reload the form whenever the sheet is opened on a different day.
  useEffect(() => {
    if (!open) return
    setStart(shift?.start ?? '08:00')
    setEnd(shift?.end ?? '17:00')
    setBreaks(shift?.breaks ?? [])
    setExs(exceptions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shift, date])

  const draft: MockShift = { date: date ?? '', start, end, breaks, status: shift?.status ?? 'DRAFT' }
  const spanValid = minutesOf(end) > minutesOf(start)
  const outOfRange = breaks.filter(
    b => minutesOf(b.start) < minutesOf(start) || minutesOf(b.end) > minutesOf(end),
  ).length

  const setBreak = (i: number, patch: Partial<MockBreak>) =>
    setBreaks(prev => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)))

  const addBreak = (kind: MockBreak['kind']) =>
    setBreaks(prev => [...prev, kind === 'LUNCH'
      ? { kind, start: '12:00', end: '12:30' }
      : { kind, start: '10:00', end: '10:15' }])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[440px] flex-col overflow-y-auto sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>{personName ?? 'Shift'}</SheetTitle>
          <SheetDescription>
            {date
              ? parseLocal(date).toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })
              : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="shift-start">Shift start</Label>
              <Input id="shift-start" type="time" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shift-end">Shift end</Label>
              <Input id="shift-end" type="time" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>

          {!spanValid && (
            <p className="text-[12px] font-medium text-destructive">
              Shift end must be after shift start.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Breaks and lunch</Label>
              <span className="text-[11px] text-slate-400">{breaks.length} of {MAX_BREAKS}</span>
            </div>

            {breaks.length === 0 && (
              <p className="text-[12px] text-slate-400">No breaks scheduled.</p>
            )}

            {breaks.map((b, i) => {
              const bad = minutesOf(b.start) < minutesOf(start) || minutesOf(b.end) > minutesOf(end)
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-end gap-2 rounded-lg border p-2',
                    bad ? 'border-destructive/40 bg-destructive/5' : 'border-slate-200',
                  )}
                >
                  <div className="flex w-[68px] shrink-0 items-center gap-1 pb-2 text-[12px] font-medium text-slate-600">
                    {b.kind === 'LUNCH'
                      ? <UtensilsCrossed className="h-3.5 w-3.5 text-warning" />
                      : <Coffee className="h-3.5 w-3.5 text-warning" />}
                    {b.kind === 'LUNCH' ? 'Lunch' : 'Break'}
                  </div>
                  <Input
                    type="time"
                    aria-label={`${b.kind} start`}
                    value={b.start}
                    onChange={e => setBreak(i, { start: e.target.value })}
                    className="h-9"
                  />
                  <Input
                    type="time"
                    aria-label={`${b.kind} end`}
                    value={b.end}
                    onChange={e => setBreak(i, { end: e.target.value })}
                    className="h-9"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-destructive"
                    aria-label="Remove"
                    onClick={() => setBreaks(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}

            {outOfRange > 0 && (
              <p className="text-[12px] font-medium text-destructive">
                {outOfRange === 1 ? 'A break falls' : `${outOfRange} breaks fall`} outside the shift.
              </p>
            )}

            {breaks.length < MAX_BREAKS && (
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => addBreak('BREAK')}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Break
                </Button>
                <Button variant="outline" size="sm" onClick={() => addBreak('LUNCH')}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Lunch
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg bg-surface p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">Paid hours</span>
              <span className="text-[13px] font-semibold text-slate-700">
                {spanValid ? fmtHours(paidMinutes(draft)) : '\u2014'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Lunch is unpaid and excluded. Breaks stay inside paid time.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <ExceptionEditor value={exs} onChange={setExs} date={date ?? ''} shift={shift} />
          </div>
        </div>

        <SheetFooter className="mt-8 gap-2">
          {shift && onDelete && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={saving}
              onClick={async () => { await onDelete(); onOpenChange(false) }}
            >
              Delete shift
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!spanValid || outOfRange > 0 || saving}
            onClick={async () => {
              if (onSave) await onSave({ start, end, breaks })
              onOpenChange(false)
            }}
          >
            {saving ? 'Saving\u2026' : 'Save shift'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
