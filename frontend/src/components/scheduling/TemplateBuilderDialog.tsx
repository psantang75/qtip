/**
 * MOCKUP — Phase 1 design probe only.
 *
 * Template builder: a named week you can apply to anyone. Each day expands to
 * its full set of times rather than showing 49 inputs at once, and "Repeat to
 * weekdays" copies one day's shape across Mon-Fri, which is how most of these
 * get built.
 *
 * Local state only — Save closes the dialog and changes nothing.
 */
import { useEffect, useState } from 'react'
import { CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { MockBreak, MockTemplate, TemplateDay } from './mockScheduleData'
import { fmtCompact, fmtHours, templateDayPaid } from './scheduleTime'

/** Business week runs Sunday to Saturday. */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_IDX = [1, 2, 3, 4, 5]

const OFF: TemplateDay = { working: false, start: '08:00', end: '17:00', breaks: [] }
const STANDARD: TemplateDay = {
  working: true, start: '08:00', end: '17:00',
  breaks: [
    { kind: 'BREAK', start: '10:00', end: '10:15' },
    { kind: 'LUNCH', start: '12:00', end: '12:30' },
    { kind: 'BREAK', start: '14:30', end: '14:45' },
  ],
}

/** Breaks/lunches always list in clock order, however they were added. */
const sortBreaks = (breaks: MockBreak[]): MockBreak[] =>
  [...breaks].sort((a, b) => a.start.localeCompare(b.start))

function summarise(d: TemplateDay): string {
  if (!d.working) return 'Off'
  const parts = [`${fmtCompact(d.start)}\u2013${fmtCompact(d.end)}`]
  const lunch = d.breaks.find(b => b.kind === 'LUNCH')
  if (lunch) parts.push(`L ${fmtCompact(lunch.start)}`)
  const rests = d.breaks.filter(b => b.kind === 'BREAK')
  if (rests.length) parts.push(`B ${rests.map(r => fmtCompact(r.start)).join(', ')}`)
  return parts.join(' \u00b7 ')
}


interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Omit to build a new template. */
  template?: MockTemplate
  readOnly?: boolean
  /** Commit handler. When absent the dialog is inert (view/mock only). */
  onSave?: (payload: { id?: number; name: string; description: string; days: TemplateDay[] }) => Promise<void> | void
  saving?: boolean
}

export function TemplateBuilderDialog({ open, onOpenChange, template, readOnly, onSave, saving }: Props) {
  const [name, setName] = useState('')
  const [days, setDays] = useState<TemplateDay[]>(
    () => DAYS.map((_, i) => (WEEKDAY_IDX.includes(i) ? { ...STANDARD } : { ...OFF })),
  )
  const [editing, setEditing] = useState<number | null>(1)

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? '')
    setDays(template
      ? template.days.map(d => ({ ...d, breaks: sortBreaks(d.breaks) }))
      : DAYS.map((_, i) => (WEEKDAY_IDX.includes(i) ? { ...STANDARD } : { ...OFF })))
    setEditing(readOnly ? null : 1)
  }, [open, template, readOnly])

  const patch = (i: number, p: Partial<TemplateDay>) =>
    setDays(prev => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)))

  const patchBreak = (i: number, bi: number, p: Partial<MockBreak>) =>
    setDays(prev => prev.map((d, idx) => idx === i
      ? { ...d, breaks: d.breaks.map((b, x) => (x === bi ? { ...b, ...p } : b)) }
      : d))

  const repeatToWeekdays = (i: number) =>
    setDays(prev => prev.map((d, idx) =>
      WEEKDAY_IDX.includes(idx) ? { ...prev[i], breaks: [...prev[i].breaks] } : d))

  const weeklyPaid = days.reduce((s, d) => s + templateDayPaid(d), 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? template?.name : template ? `Edit ${template.name}` : 'New schedule template'}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? template?.description
              : 'Build one week, then apply it to anyone. Editing a template later does not change schedules already generated from it.'}
          </DialogDescription>
        </DialogHeader>

        {!readOnly && (
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Standard 8-5, or Rotating Late"
              className="max-w-sm"
            />
          </div>
        )}

        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
          {days.map((day, i) => (
            <div
              key={DAYS[i]}
              className={cn(
                'rounded-lg border',
                editing === i ? 'border-primary/40 bg-primary/[0.03]' : 'border-slate-200',
              )}
            >
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="w-[86px] shrink-0 text-[13px] font-medium text-slate-700">
                  {DAYS[i]}
                </span>
                {!readOnly && (
                  <Switch
                    checked={day.working}
                    onCheckedChange={v => patch(i, v ? { ...STANDARD } : { working: false })}
                    aria-label={`${DAYS[i]} working`}
                  />
                )}
                <span className={cn(
                  'flex-1 truncate text-[12px] tabular-nums',
                  day.working ? 'text-slate-600' : 'text-slate-400',
                )}>
                  {summarise(day)}
                </span>

                {day.working && !readOnly && (
                  <>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 px-2 text-[11px] text-slate-500"
                      onClick={() => repeatToWeekdays(i)}
                      title="Copy this day to Monday through Friday"
                    >
                      <CopyPlus className="mr-1 h-3.5 w-3.5" /> Repeat to weekdays
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 px-2 text-[11px] text-primary hover:bg-primary/5 hover:text-primary"
                      onClick={() => setEditing(editing === i ? null : i)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> {editing === i ? 'Done' : 'Edit'}
                    </Button>
                  </>
                )}
              </div>

              {editing === i && day.working && (
                <div className="space-y-2 border-t border-slate-200 px-3 py-3">
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Start</Label>
                      <Input type="time" value={day.start} onChange={e => patch(i, { start: e.target.value })} className="h-9 w-[120px]" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">End</Label>
                      <Input type="time" value={day.end} onChange={e => patch(i, { end: e.target.value })} className="h-9 w-[120px]" />
                    </div>
                    <span className="pb-2 text-[11px] text-slate-400">
                      {fmtHours(templateDayPaid(day))} paid
                    </span>
                  </div>

                  {day.breaks.map((b, bi) => (
                    <div key={bi} className="flex items-end gap-2">
                      <span className="w-[86px] pb-2 text-[11px] font-medium text-slate-500">
                        {b.kind === 'LUNCH' ? 'Lunch' : `Break ${day.breaks.filter((x, xi) => x.kind === 'BREAK' && xi <= bi).length}`}
                      </span>
                      <Input type="time" value={b.start} onChange={e => patchBreak(i, bi, { start: e.target.value })} className="h-9 w-[120px]" />
                      <Input type="time" value={b.end} onChange={e => patchBreak(i, bi, { end: e.target.value })} className="h-9 w-[120px]" />
                      <Button
                        variant="ghost" size="sm"
                        className="h-9 w-9 p-0 text-slate-400 hover:text-destructive"
                        aria-label="Remove"
                        onClick={() => patch(i, { breaks: day.breaks.filter((_, x) => x !== bi) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  {day.breaks.length < 3 && (
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => patch(i, { breaks: sortBreaks([...day.breaks, { kind: 'BREAK', start: '10:00', end: '10:15' }]) })}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Break
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => patch(i, { breaks: sortBreaks([...day.breaks, { kind: 'LUNCH', start: '12:00', end: '12:30' }]) })}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Lunch
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-[12px] text-slate-500">
            {days.filter(d => d.working).length} working days &middot;{' '}
            <span className="font-semibold text-slate-700">{fmtHours(weeklyPaid)}</span> paid per week
          </span>
          {readOnly ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name.trim() || saving}
                onClick={async () => {
                  if (onSave) {
                    await onSave({
                      id: template?.id || undefined,
                      name: name.trim(),
                      description: template?.description ?? '',
                      days,
                    })
                  }
                  onOpenChange(false)
                }}
              >
                {saving ? 'Saving\u2026' : 'Save template'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
