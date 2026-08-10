/**
 * MOCKUP — Phase 1 design probe only.
 *
 * One dialog for both bulk writes — Apply Template and Copy a Prior Week.
 *
 * The source is always exactly one week, and it maps onto the target by
 * weekday: the source Monday becomes the target Monday, whatever the target
 * span is. A two-week target therefore repeats the same source week twice. That
 * single rule is what keeps "copy a week onto one day" from being ambiguous.
 *
 * Both ends are stated as real dates, and the counts are shown before anything
 * is written, because a bulk write between 1 and 14 days has no undo.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  addDays, MOCK_TEMPLATES, parseLocal, startOfWeek,
  type MockPerson, type MockTemplate,
} from './mockScheduleData'
import { TemplateTable } from './TemplateTable'
import schedulingService from '@/services/schedulingService'

export type ApplyMode = 'template' | 'copy'
export type ApplyScope = 'day' | 'week' | 'period'

const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]'

const fmtDay = (iso: string) =>
  parseLocal(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

const fmtWeek = (ws: string) => `${fmtDay(ws)} \u2013 ${fmtDay(addDays(ws, 6))}`

/** A pill row that behaves like a radio group, using the canonical QTIP style. */
function PillGroup<T extends string>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string; hint?: string }[]
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-9 rounded border px-3 text-[12px] font-medium transition-all',
            optionCls(value === o.id),
          )}
        >
          {o.label}
          {o.hint && (
            <span className={cn('ml-1.5 text-[10.5px]', value === o.id ? 'text-white/70' : 'text-slate-400')}>
              {o.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: ApplyMode
  people: MockPerson[]
  /** The view the user launched from. Seeds the scope and gates the day option. */
  view: ApplyScope
  /** Focused day in the day view. */
  day: string
  /** First day of the displayed period in the week and 2-week views. */
  anchor: string
  /** Live templates (adapted to the mock shape); falls back to fixtures. */
  templates?: MockTemplate[]
  /** Commit handler — resolved dates + source. When absent the dialog is inert. */
  onConfirm?: (payload: { mode: ApplyMode; dates: string[]; templateId?: number; sourceWeekStart?: string }) => Promise<void> | void
  submitting?: boolean
}

export function ApplyScheduleDialog({
  open, onOpenChange, mode, people, view, day, anchor, templates, onConfirm, submitting,
}: Props) {
  const templateList = templates ?? MOCK_TEMPLATES
  const [scope, setScope] = useState<ApplyScope>(view)
  const [templateId, setTemplateId] = useState<number | undefined>()
  const [weeksBack, setWeeksBack] = useState<'1' | '2'>('1')

  useEffect(() => {
    if (!open) return
    setScope(view)
    setTemplateId(undefined)
  }, [open, view])

  const targetWeek = view === 'day' ? startOfWeek(day) : anchor

  const dates = useMemo(() => {
    if (scope === 'day') return [day]
    return Array.from({ length: scope === 'week' ? 7 : 14 }, (_, i) => addDays(targetWeek, i))
  }, [scope, day, targetWeek])

  /** Source is one week, matched to the target by weekday. */
  const sourceWeek = addDays(targetWeek, -7 * Number(weeksBack))
  const sourceFor = (iso: string) => addDays(sourceWeek, parseLocal(iso).getDay())

  const template = templateList.find(t => t.id === templateId)
  const ready = mode === 'copy' || !!template

  // Preview runs the identical server code path with dry_run, so the counts shown
  // can never drift from what the write does — and copy mode can see the prior
  // week, which the loaded grid does not contain (the old client-side tally could
  // not, which is why it always read 0).
  const previewQ = useQuery({
    queryKey: ['apply-preview', mode, dates, sourceWeek, templateId, people.map(p => p.id)],
    queryFn: () => schedulingService.apply({
      mode,
      dates,
      user_ids: people.map(p => p.id),
      template_id: mode === 'template' ? templateId : undefined,
      source_week_start: mode === 'copy' ? sourceWeek : undefined,
      dry_run: true,
    }),
    enabled: open && people.length > 0 && ready,
  })
  const preview = previewQ.data

  /** The one sentence that has to be unambiguous. */
  const sentence = mode === 'copy'
    ? scope === 'day'
      ? `Copies ${fmtDay(sourceFor(dates[0]))} onto ${fmtDay(dates[0])} \u2014 same weekday, ${weeksBack === '1' ? 'one week' : 'two weeks'} apart.`
      : scope === 'week'
        ? `Copies ${fmtWeek(sourceWeek)} onto ${fmtWeek(targetWeek)}, day for day \u2014 Sunday to Sunday, Monday to Monday.`
        : `Repeats ${fmtWeek(sourceWeek)} across both target weeks \u2014 ${fmtWeek(targetWeek)} and ${fmtWeek(addDays(targetWeek, 7))} each get that same pattern.`
    : scope === 'day'
      ? `Writes the ${parseLocal(dates[0]).toLocaleDateString('en-US', { weekday: 'long' })} of "${template?.name}" onto ${fmtDay(dates[0])}.`
      : scope === 'week'
        ? `Writes "${template?.name}" onto ${fmtWeek(targetWeek)}.`
        : `Writes "${template?.name}" onto both ${fmtWeek(targetWeek)} and ${fmtWeek(addDays(targetWeek, 7))}.`

  const Icon = mode === 'copy' ? Copy : CalendarPlus

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={mode === 'copy' ? 'max-w-xl' : 'max-w-5xl'}>
        <DialogHeader>
          <DialogTitle>{mode === 'copy' ? 'Copy a prior week' : 'Apply a template'}</DialogTitle>
          <DialogDescription>
            {people.length} {people.length === 1 ? 'employee' : 'employees'} selected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12px]">
              {mode === 'copy' ? 'Copy from' : 'Choose a template'}
            </Label>
            {mode === 'copy' ? (
              <>
                <PillGroup<'1' | '2'>
                  value={weeksBack}
                  onChange={setWeeksBack}
                  options={[
                    { id: '1', label: 'Previous week' },
                    { id: '2', label: 'Two weeks ago' },
                  ]}
                />
                <p className="text-[12px] tabular-nums text-slate-500">{fmtWeek(sourceWeek)}</p>
              </>
            ) : (
              <TemplateTable
                templates={templateList}
                pickedId={templateId}
                onPick={t => setTemplateId(t.id)}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px]">Apply to</Label>
            <PillGroup<ApplyScope>
              value={scope}
              onChange={setScope}
              options={[
                // Only offered from the day view, where "this day" names itself.
                ...(view === 'day' ? [{ id: 'day' as const, label: 'This day', hint: '1 day' }] : []),
                { id: 'week' as const, label: 'This week', hint: '7 days' },
                { id: 'period' as const, label: 'Two weeks', hint: '14 days' },
              ]}
            />
            <p className="text-[12px] tabular-nums text-slate-500">
              {dates.length === 1 ? fmtDay(dates[0]) : `${fmtDay(dates[0])} \u2013 ${fmtDay(dates[dates.length - 1])}`}
            </p>
          </div>

          <div className={cn(
            'rounded-lg border border-slate-200 bg-slate-50/60 p-3',
            !ready && 'opacity-50',
          )}>
            <p className="text-[12px] font-semibold text-neutral-900">What this will do</p>
            <p className="mt-1 text-[12.5px] leading-snug text-slate-700">
              {ready ? sentence : 'Pick a template above.'}
            </p>
            {ready && (
              previewQ.isFetching && !preview ? (
                <p className="mt-2 text-[12.5px] text-slate-500">{'Calculating\u2026'}</p>
              ) : previewQ.isError ? (
                <p className="mt-2 text-[12.5px] text-destructive">Couldn't calculate this. Try again.</p>
              ) : preview ? (
                <ul className="mt-2 space-y-1 text-[12.5px] text-slate-600">
                  <li>
                    Writes <span className="font-semibold text-neutral-900">{preview.write}</span>{' '}
                    {preview.write === 1 ? 'shift' : 'shifts'} across {dates.length}{' '}
                    {dates.length === 1 ? 'day' : 'days'}.
                  </li>
                  {preview.overwrite > 0 && (
                    <li>Replaces {preview.overwrite} existing draft {preview.overwrite === 1 ? 'shift' : 'shifts'}.</li>
                  )}
                  {preview.clearDays > 0 && (
                    <li>Clears {preview.clearDays} {preview.clearDays === 1 ? 'day' : 'days'} the source leaves off.</li>
                  )}
                  {preview.holiday > 0 && (
                    <li>Skips {preview.holiday} company {preview.holiday === 1 ? 'holiday' : 'holidays'}.</li>
                  )}
                  {preview.published > 0 && (
                    <li className="text-destructive">
                      Skips {preview.published} published {preview.published === 1 ? 'day' : 'days'}.
                    </li>
                  )}
                </ul>
              ) : null
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              !ready || !people.length || submitting ||
              previewQ.isFetching || !preview ||
              preview.write + preview.overwrite + preview.clearDays === 0
            }
            onClick={async () => {
              if (onConfirm) {
                await onConfirm({
                  mode,
                  dates,
                  templateId: mode === 'template' ? templateId : undefined,
                  sourceWeekStart: mode === 'copy' ? sourceWeek : undefined,
                })
              }
              onOpenChange(false)
            }}
          >
            <Icon className="mr-1.5 h-4 w-4" />
            {submitting ? 'Working\u2026' : mode === 'copy' ? 'Copy' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
