/**
 * MOCKUP — Phase 1 design probe only. Local state, saves nothing.
 *
 * Logs one exception across every checked employee — a company closure, a team
 * training block, a department sent home early. The per-day version lives in the
 * shift drawer; this is the same record written N times.
 *
 * Unlike the schedule writes, this is deliberately **not** gated on publish
 * state. Logging that someone was late last Tuesday is the normal case, and
 * last Tuesday is exactly the week that is published and elapsed.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  addDays, MOCK_EXCEPTION_TYPES, parseLocal, type MockPerson,
} from './mockScheduleData'
import { findExceptionOverlap, minutesOf } from './scheduleTime'

const fmtDay = (iso: string) =>
  parseLocal(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  people: MockPerson[]
  /** Seeds the date, so the dialog opens on whatever you were looking at. */
  defaultDate: string
  /** Commit handler. When absent the dialog is inert (mockup). */
  onConfirm?: (payload: { from: string; to: string; typeLabel: string; isFullDay: boolean; start: string; end: string }) => Promise<void> | void
  submitting?: boolean
}

export function BulkExceptionDialog({ open, onOpenChange, people, defaultDate, onConfirm, submitting }: Props) {
  const [from, setFrom] = useState(defaultDate)
  const [to, setTo] = useState(defaultDate)
  const [typeLabel, setTypeLabel] = useState('')
  const [isFullDay, setIsFullDay] = useState(false)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('10:00')

  useEffect(() => {
    if (!open) return
    setFrom(defaultDate)
    setTo(defaultDate)
    setTypeLabel('')
    setIsFullDay(false)
  }, [open, defaultDate])

  const type = MOCK_EXCEPTION_TYPES.find(t => t.label === typeLabel)
  const forcesFullDay = type?.mode === 'FULL_DAY'
  const forcesWindow = type?.mode === 'WINDOW'
  const effectiveFullDay = forcesFullDay || (!forcesWindow && isFullDay)

  const rangeValid = to >= from
  const windowValid = effectiveFullDay || minutesOf(end) > minutesOf(start)

  const dates = useMemo(() => {
    if (!rangeValid) return []
    const out: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
    return out
  }, [from, to, rangeValid])

  const preview = useMemo(() => {
    let write = 0
    let unscheduled = 0
    let outside = 0
    let conflict = 0

    for (const p of people) {
      for (const iso of dates) {
        const shift = p.shifts.find(s => s.date === iso)
        if (!shift) { unscheduled += 1; continue }

        // A conflict skips that one person's day rather than blocking the whole
        // write — a closure logged across twelve people should not fail because
        // one of them already has PTO on the books.
        const existing = p.exceptions.filter(e => e.date === iso)
        if (findExceptionOverlap(existing, { isFullDay: effectiveFullDay, start, end })) {
          conflict += 1
          continue
        }

        write += 1
        if (!effectiveFullDay
          && (minutesOf(start) < minutesOf(shift.start) || minutesOf(end) > minutesOf(shift.end))) {
          outside += 1
        }
      }
    }
    return { write, unscheduled, outside, conflict }
  }, [people, dates, effectiveFullDay, start, end])

  const ready = !!type && rangeValid && windowValid && preview.write > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Log an exception</DialogTitle>
          <DialogDescription>
            {people.length} {people.length === 1 ? 'employee' : 'employees'} selected.
            Whether it is excused comes from the type, not from a choice here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Type</Label>
            <Select value={typeLabel} onValueChange={setTypeLabel}>
              <SelectTrigger className="h-9 max-w-sm">
                <SelectValue placeholder={'Choose an exception type\u2026'} />
              </SelectTrigger>
              <SelectContent>
                {MOCK_EXCEPTION_TYPES.map(t => (
                  <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type && (
              <p className={cn(
                'text-[11.5px] font-medium',
                type.excused ? 'text-warning' : 'text-destructive',
              )}>
                {type.excused
                  ? 'Excused \u2014 does not count against the employee.'
                  : 'Not excused \u2014 counts against the employee.'}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px]">Dates</Label>
            <div className="flex items-center gap-2">
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-[160px]" />
              <span className="text-[12px] text-slate-400">to</span>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-[160px]" />
            </div>
            {!rangeValid && (
              <p className="text-[11.5px] font-medium text-destructive">
                The end date is before the start date.
              </p>
            )}
          </div>

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
                {forcesFullDay && <span className="ml-1 text-slate-400">(always, for this type)</span>}
              </span>
            </div>
          )}

          {type && !effectiveFullDay && (
            <div className="space-y-1.5">
              <Label className="text-[12px]">Hours affected</Label>
              <div className="flex items-center gap-2">
                <Input type="time" value={start} onChange={e => setStart(e.target.value)} className="h-9 w-[120px]" />
                <span className="text-[12px] text-slate-400">to</span>
                <Input type="time" value={end} onChange={e => setEnd(e.target.value)} className="h-9 w-[120px]" />
              </div>
              {!windowValid && (
                <p className="text-[11.5px] font-medium text-destructive">End must be after start.</p>
              )}
              <p className="text-[11.5px] leading-relaxed text-slate-500">
                The window is matched against punch data, so it has to be the hours actually
                affected. The same two hours forgive opposite ends of the shift depending on
                where they sit.
              </p>
            </div>
          )}

          <div className={cn(
            'rounded-lg border border-slate-200 bg-slate-50/60 p-3',
            !type && 'opacity-50',
          )}>
            <p className="text-[12px] font-semibold text-neutral-900">What this will do</p>
            {type ? (
              <>
                <p className="mt-1 text-[12.5px] leading-snug text-slate-700">
                  Logs <span className="font-semibold">{type.label}</span> for {people.length}{' '}
                  {people.length === 1 ? 'employee' : 'employees'} across{' '}
                  {dates.length === 1
                    ? fmtDay(dates[0] ?? from)
                    : `${fmtDay(from)} \u2013 ${fmtDay(to)}`}.
                </p>
                <ul className="mt-2 space-y-1 text-[12.5px] text-slate-600">
                  <li>
                    Writes <span className="font-semibold text-neutral-900">{preview.write}</span>{' '}
                    {preview.write === 1 ? 'exception' : 'exceptions'}.
                  </li>
                  {preview.unscheduled > 0 && (
                    <li>
                      Skips {preview.unscheduled} unscheduled{' '}
                      {preview.unscheduled === 1 ? 'day' : 'days'} &mdash; there is no shift to
                      make an exception to.
                    </li>
                  )}
                  {preview.conflict > 0 && (
                    <li>
                      Skips {preview.conflict}{' '}
                      {preview.conflict === 1 ? 'day that already has' : 'days that already have'}{' '}
                      an overlapping exception &mdash; the existing one stands.
                    </li>
                  )}
                  {effectiveFullDay && type.excused && (
                    <li>
                      Full-day excused days drop out of the attendance denominator rather than
                      counting as compliant shifts.
                    </li>
                  )}
                  {preview.outside > 0 && (
                    <li className="flex items-start gap-1.5 text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      That window falls outside the scheduled shift on {preview.outside}{' '}
                      {preview.outside === 1 ? 'day' : 'days'}.
                    </li>
                  )}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-[12.5px] text-slate-500">Choose a type above.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready || preview.outside > 0 || submitting}
            onClick={async () => {
              if (onConfirm && type) {
                await onConfirm({ from, to, typeLabel: type.label, isFullDay: effectiveFullDay, start, end })
              }
              onOpenChange(false)
            }}
          >
            <CalendarX className="mr-1.5 h-4 w-4" /> {submitting ? 'Working\u2026' : 'Log exception'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
