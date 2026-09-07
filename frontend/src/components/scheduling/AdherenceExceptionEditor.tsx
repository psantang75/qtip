/**
 * Adherence exceptions live in the shift drawer, right below the attendance
 * exceptions, because they are an adjustment to that specific day's breaks and
 * lunches — the same place a manager is already looking at them. Whether an
 * exception is excused comes from its type, never from a checkbox here.
 *
 * The segment picker is built from the day's own scheduled breaks and lunches, so
 * a manager selects the exact one that was affected. Each option maps to the kind
 * and the sorted-by-start sequence the adherence engine scores against.
 */
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAdherenceExceptionTypes } from '@/hooks/useAdherenceExceptionTypes'
import type { MockAdherenceException, MockShift } from './mockScheduleData'
import { fmtCompact, minutesOf } from './scheduleTime'

interface SegmentOption {
  key: string
  kind: 'BREAK' | 'LUNCH'
  seq: number
  label: string
}

/**
 * The day's scheduled breaks and lunches as pickable segments. Each kind is
 * sorted by start and numbered from 1, matching the engine's seq so the exception
 * lands on the same instance the report scores.
 */
function segmentOptions(shift?: MockShift): SegmentOption[] {
  const opts: SegmentOption[] = []
  for (const kind of ['BREAK', 'LUNCH'] as const) {
    const fam = (shift?.breaks ?? [])
      .filter(b => b.kind === kind)
      .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
    fam.forEach((b, i) => {
      const name = kind === 'BREAK' ? 'Break' : 'Lunch'
      opts.push({
        key: `${kind}:${i + 1}`,
        kind,
        seq: i + 1,
        label: `${name} ${i + 1} \u00b7 ${fmtCompact(b.start)}\u2013${fmtCompact(b.end)}`,
      })
    })
  }
  return opts
}

const segName = (kind: 'BREAK' | 'LUNCH') => (kind === 'BREAK' ? 'Break' : 'Lunch')

interface Props {
  value: MockAdherenceException[]
  onChange: (next: MockAdherenceException[]) => void
  shift?: MockShift
}

export function AdherenceExceptionEditor({ value, onChange, shift }: Props) {
  const [adding, setAdding] = useState(false)
  const [segKey, setSegKey] = useState('')
  const [typeId, setTypeId] = useState('')
  const [reason, setReason] = useState('')

  const typesQ = useAdherenceExceptionTypes()
  const types = typesQ.data ?? []
  const type = types.find(t => String(t.id) === typeId)

  const allSegments = segmentOptions(shift)
  // A segment can carry only one exception — offer only the ones still free.
  const taken = new Set(value.map(v => `${v.segmentKind}:${v.seq}`))
  const openSegments = allSegments.filter(o => !taken.has(o.key))
  const seg = allSegments.find(o => o.key === segKey)

  const segLabelFor = (kind: 'BREAK' | 'LUNCH', seq: number) =>
    allSegments.find(o => o.kind === kind && o.seq === seq)?.label ?? `${segName(kind)} ${seq}`

  const reset = () => {
    setAdding(false)
    setSegKey('')
    setTypeId('')
    setReason('')
  }

  const add = () => {
    if (!seg || !type) return
    onChange([...value, {
      segmentKind: seg.kind,
      seq: seg.seq,
      exceptionTypeId: type.id,
      typeLabel: type.label,
      excused: type.is_excused,
      reason: reason.trim() || undefined,
    }])
    reset()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Adherence Exceptions</Label>
        {!adding && allSegments.length > 0 && (
          <Button
            variant="ghost" size="sm"
            className="h-7 px-2 text-[12px] text-primary hover:bg-primary/5 hover:text-primary"
            onClick={() => setAdding(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add exception
          </Button>
        )}
      </div>

      {allSegments.length === 0 && (
        <p className="text-[12px] text-slate-400">
          No breaks or lunches scheduled.
        </p>
      )}

      {allSegments.length > 0 && value.length === 0 && !adding && (
        <p className="text-[12px] text-slate-400">
          None. Every break and lunch is scored as posted.
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
          <span className="text-[12px] font-medium text-slate-600">
            {segLabelFor(ex.segmentKind, ex.seq)}
          </span>
          <span className={cn(
            'text-[12px] font-semibold',
            ex.excused ? 'text-warning' : 'text-destructive',
          )}>
            {ex.typeLabel}
          </span>
          <span className="ml-auto whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {ex.excused ? 'Excused' : 'Recorded'}
          </span>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-destructive"
            aria-label="Remove adherence exception"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">Break or lunch</Label>
            <Select value={segKey} onValueChange={setSegKey} disabled={openSegments.length === 0}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={openSegments.length === 0 ? 'All segments already have one' : 'Choose a break or lunch\u2026'} />
              </SelectTrigger>
              <SelectContent>
                {openSegments.map(o => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px]">Type</Label>
            <Select value={typeId} onValueChange={setTypeId} disabled={typesQ.isLoading}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={typesQ.isLoading ? 'Loading\u2026' : 'Choose an exception type\u2026'} />
              </SelectTrigger>
              <SelectContent>
                {types.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type && (
            <p className={cn(
              'text-[11px] font-medium',
              type.is_excused ? 'text-warning' : 'text-destructive',
            )}>
              {type.is_excused
                ? 'Excused \u2014 forgives this segment\u2019s adherence points.'
                : 'Not excused \u2014 recorded only, points still count.'}
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px]">Note (optional)</Label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={255}
              placeholder="Context for this exception"
              className="h-9"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>
            <Button
              variant="primary" size="sm"
              disabled={!seg || !type}
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
