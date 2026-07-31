/**
 * MOCKUP — Phase 1 design probe only. Local state, saves nothing.
 *
 * Exceptions live in the shift drawer because they are an adjustment to that
 * specific day's schedule, not a separate record a manager should have to go
 * find. Whether an exception is excused comes from its type, never from a
 * checkbox here — the paired list (Excused/Unexcused Late Arrival, and so on)
 * is what carries that decision.
 */
import { useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { MOCK_EXCEPTION_TYPES, type MockException, type MockShift } from './mockScheduleData'
import { fmtCompact, findExceptionOverlap, minutesOf } from './scheduleTime'

interface Props {
  value: MockException[]
  onChange: (next: MockException[]) => void
  date: string
  shift?: MockShift
}

export function ExceptionEditor({ value, onChange, date, shift }: Props) {
  const [adding, setAdding] = useState(false)
  const [typeLabel, setTypeLabel] = useState('')
  const [isFullDay, setIsFullDay] = useState(false)
  const [start, setStart] = useState(shift?.start ?? '08:00')
  const [end, setEnd] = useState('10:00')

  const type = MOCK_EXCEPTION_TYPES.find(t => t.label === typeLabel)
  const forcesFullDay = type?.mode === 'FULL_DAY'
  const forcesWindow = type?.mode === 'WINDOW'
  const effectiveFullDay = forcesFullDay || (!forcesWindow && isFullDay)

  const windowValid = effectiveFullDay || minutesOf(end) > minutesOf(start)
  const outsideShift = !effectiveFullDay && shift
    ? minutesOf(start) < minutesOf(shift.start) || minutesOf(end) > minutesOf(shift.end)
    : false
  const overlap = type && windowValid
    ? findExceptionOverlap(value, { isFullDay: effectiveFullDay, start, end })
    : null

  const reset = () => {
    setAdding(false)
    setTypeLabel('')
    setIsFullDay(false)
    setStart(shift?.start ?? '08:00')
    setEnd('10:00')
  }

  const add = () => {
    if (!type || overlap) return
    onChange([...value, {
      date,
      typeLabel: type.label,
      excused: type.excused,
      isFullDay: effectiveFullDay,
      ...(effectiveFullDay ? {} : { start, end }),
    }])
    reset()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Exceptions</Label>
        {!adding && (
          <Button
            variant="ghost" size="sm"
            className="h-7 px-2 text-[12px] text-primary hover:bg-primary/5 hover:text-primary"
            onClick={() => setAdding(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add exception
          </Button>
        )}
      </div>

      {value.length === 0 && !adding && (
        <p className="text-[12px] text-slate-400">
          None. The employee is expected to work this shift as posted.
        </p>
      )}

      {value.map((ex, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-2.5 py-2',
            ex.excused ? 'border-warning/40 bg-warning/[0.07]' : 'border-destructive/40 bg-destructive/[0.06]',
          )}
        >
          <span className={cn(
            'text-[12px] font-semibold',
            ex.excused ? 'text-warning' : 'text-destructive',
          )}>
            {ex.typeLabel}
          </span>
          <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-slate-500">
            {ex.isFullDay ? 'Full day' : `${fmtCompact(ex.start!)}\u2013${fmtCompact(ex.end!)}`}
          </span>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-destructive"
            aria-label="Remove exception"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">Type</Label>
            <Select value={typeLabel} onValueChange={setTypeLabel}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={'Choose an exception type\u2026'} />
              </SelectTrigger>
              <SelectContent>
                {MOCK_EXCEPTION_TYPES.map(t => (
                  <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type && (
            <p className={cn(
              'text-[11px] font-medium',
              type.excused ? 'text-warning' : 'text-destructive',
            )}>
              {type.excused
                ? 'Excused \u2014 does not count against the employee.'
                : 'Not excused \u2014 counts against the employee.'}
            </p>
          )}

          {type && !forcesWindow && (
            <div className="flex items-center gap-2">
              <Switch
                checked={effectiveFullDay}
                disabled={forcesFullDay}
                onCheckedChange={setIsFullDay}
                aria-label="Full day"
              />
              <span className="text-[12px] text-slate-600">
                Full day
                {forcesFullDay && (
                  <span className="ml-1 text-slate-400">(always, for this type)</span>
                )}
              </span>
            </div>
          )}

          {type && !effectiveFullDay && (
            <>
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">From</Label>
                  <Input type="time" value={start} onChange={e => setStart(e.target.value)} className="h-9 w-[120px]" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">To</Label>
                  <Input type="time" value={end} onChange={e => setEnd(e.target.value)} className="h-9 w-[120px]" />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                The window is matched against punch data, so it has to be the hours actually
                affected &mdash; excused 8:00&ndash;10:00 and 3:00&ndash;5:00 are both two hours
                but forgive opposite ends of the shift.
              </p>
            </>
          )}

          {outsideShift && (
            <p className="text-[11px] font-medium text-destructive">
              That window falls outside the scheduled shift.
            </p>
          )}
          {!windowValid && (
            <p className="text-[11px] font-medium text-destructive">
              End must be after start.
            </p>
          )}
          {overlap && (
            <div className="flex gap-1.5 rounded-lg border border-destructive/40 bg-destructive/[0.06] px-2.5 py-2">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-[11px] font-medium leading-relaxed text-destructive">
                {overlap.isFullDay
                  ? `Can't save \u2014 ${overlap.typeLabel} already covers this whole day.`
                  : effectiveFullDay
                    ? `Can't save \u2014 a full day would cover ${overlap.typeLabel}, already logged ${fmtCompact(overlap.start!)}\u2013${fmtCompact(overlap.end!)}.`
                    : `Can't save \u2014 this overlaps ${overlap.typeLabel}, already logged ${fmtCompact(overlap.start!)}\u2013${fmtCompact(overlap.end!)}.`}
                <span className="font-normal"> Two exceptions covering the same hour would score it twice. Remove the existing one, or narrow this window.</span>
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>
            <Button
              variant="primary" size="sm"
              disabled={!type || !windowValid || outsideShift || !!overlap}
              onClick={add}
            >
              Add exception
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
