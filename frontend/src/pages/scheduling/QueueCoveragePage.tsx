/**
 * Phone Queues — who should be staffing which queue, for one department.
 *
 * The plan is solved on read from the work schedule, so PTO, a shift change or
 * a rule change shows up on the next load with nothing to publish. QTIP is the
 * plan of record: nothing here is pushed to Genesys, whose database QTIP only
 * ever reads.
 *
 * The page is a shell. It owns the department, the date, the Day/Week choice
 * and the writes; the two boards own everything about how a day is drawn. It
 * used to own three surfaces at once — a coverage board per time frame, a
 * roster panel repeating the membership, and a list of manual changes — which
 * is what made a simple question take three places to answer.
 *
 * The "updated" stamp next to Refresh comes from `dataUpdatedAt`, so if a save
 * ever appears not to take, it says immediately whether the refetch fired or
 * the response itself was stale.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RefreshCw, Settings2, TriangleAlert } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { t } from '@/lib/t'
import { cn } from '@/lib/utils'
import { optionCls } from '@/utils/forms/optionCls'
import { useScheduleRole } from '@/hooks/useScheduleRole'
import { QueueDayBoard } from '@/components/scheduling/QueueDayBoard'
import { QueueWeekBoard } from '@/components/scheduling/QueueWeekBoard'
import { QueueSettingsSheet } from '@/components/scheduling/QueueSettingsSheet'
import type { OverrideRequest } from '@/components/scheduling/queueDayModel'
import { nextWorkday } from '@/components/scheduling/businessDays'
import { useBusinessDayTypes } from '@/hooks/useBusinessDayTypes'
import phoneQueueService from '@/services/phoneQueueService'
import { phoneQueueKeys } from '@/services/phoneQueueQueryKeys'

type ViewMode = 'day' | 'week'
const VIEWS: Array<{ id: ViewMode; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
]

/** 'YYYY-MM-DD' from LOCAL components, per .cursor/rules/date-handling.mdc. */
const toLocalIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const shiftDate = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(y, m - 1, d)
  next.setDate(next.getDate() + days)
  return toLocalIso(next)
}

/** Monday of the week containing the date. */
const startOfWeek = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return shiftDate(iso, -((date.getDay() + 6) % 7))
}

const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

const rangeLabel = (start: string) => {
  const end = shiftDate(start, 6)
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

const clockOf = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export default function QueueCoveragePage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { canEdit } = useScheduleRole()

  // Remembered across reloads so a manager lands back on the department they
  // work, not whichever one sorts first in their scope.
  const [departmentId, setDepartmentId] = useLocalStorage<number | null>('qtip_queue_department', null)
  const [view, setView] = useState<ViewMode>('day')
  const [date, setDate] = useState(() => toLocalIso(new Date()))
  const [weekStart, setWeekStart] = useState(() => startOfWeek(toLocalIso(new Date())))
  const [includeDraft, setIncludeDraft] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const deptsQ = useQuery({ queryKey: phoneQueueKeys.departments(), queryFn: phoneQueueService.listDepartments })
  const deptOptions = useMemo(
    () => (deptsQ.data ?? []).map(d => ({ value: String(d.id), label: d.department_name })),
    [deptsQ.data],
  )

  useEffect(() => {
    const list = deptsQ.data ?? []
    if (list.length === 0 || (departmentId != null && list.some(d => d.id === departmentId))) return
    setDepartmentId(list[0].id)
  }, [deptsQ.data, departmentId, setDepartmentId])

  const dayQ = useQuery({
    queryKey: phoneQueueKeys.coverage(departmentId ?? 0, date, includeDraft),
    queryFn: () => phoneQueueService.getCoverage(departmentId!, date, includeDraft),
    enabled: departmentId != null && view === 'day',
  })
  const weekQ = useQuery({
    queryKey: phoneQueueKeys.weekCoverage(departmentId ?? 0, weekStart, includeDraft),
    queryFn: () => phoneQueueService.getWeekCoverage(departmentId!, weekStart, includeDraft),
    enabled: departmentId != null && view === 'week',
  })

  const active = view === 'day' ? dayQ : weekQ

  // Business-calendar day types for the visible window, padded so the day arrows
  // can find the next working day past the edge. ISO strings sort chronologically.
  const weekEnd = shiftDate(weekStart, 6)
  const calFrom = shiftDate(date < weekStart ? date : weekStart, -7)
  const calTo = shiftDate(date > weekEnd ? date : weekEnd, 7)
  const dayTypes = useBusinessDayTypes(calFrom, calTo).data

  const refresh = () => {
    if (departmentId == null) return
    qc.invalidateQueries({ queryKey: phoneQueueKeys.department(departmentId) })
  }

  const overrideMut = useMutation({
    mutationFn: (req: OverrideRequest) => phoneQueueService.setOverride({
      department_id: departmentId!,
      assignment_date: date,
      user_id: req.userId,
      queue_id: req.queueId,
      action: req.action,
      start: req.start,
      end: req.end,
    }),
    onSuccess: refresh,
    onError: (e) => toast(t.fromError(e)),
  })
  const clearMut = useMutation({
    mutationFn: (req: { userId: number; start: string | null; end: string | null }) =>
      phoneQueueService.clearOverrides({
        department_id: departmentId!,
        assignment_date: date,
        user_id: req.userId,
        start: req.start,
        end: req.end,
      }),
    onSuccess: refresh,
    onError: (e) => toast(t.fromError(e)),
  })

  const openDay = (iso: string) => { setDate(iso); setView('day') }

  // Day view steps to the next business day per the calendar; weekends,
  // holidays and closures carry no schedule.
  const stepBack = () => (view === 'day' ? setDate(d => nextWorkday(dayTypes, d, -1)) : setWeekStart(w => shiftDate(w, -7)))
  const stepForward = () => (view === 'day' ? setDate(d => nextWorkday(dayTypes, d, 1)) : setWeekStart(w => shiftDate(w, 7)))
  const goToday = () => {
    const today = toLocalIso(new Date())
    setDate(today)
    setWeekStart(startOfWeek(today))
  }

  const notConfigured = view === 'day' ? dayQ.data?.notConfigured : weekQ.data?.notConfigured

  return (
    <ListPageShell>
      <ListPageHeader
        title="Phone Queues"
        subtitle="Who should be on which queue, solved from the work schedule. QTIP is the plan — nothing is sent to the phone system."
        actions={canEdit && departmentId != null ? (
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="mr-1 h-4 w-4" /> Queue Settings
          </Button>
        ) : undefined}
      />

      <ListFilterBar
        selects={[{
          id: 'department',
          value: departmentId != null ? String(departmentId) : '',
          onChange: v => setDepartmentId(Number(v)),
          placeholder: 'Select a department',
          width: 'w-[240px]',
          options: deptOptions,
        }]}
        hasFilters={includeDraft}
        onReset={() => setIncludeDraft(false)}
      >
        <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[13px] text-slate-600"
          title="Preview a week that has not been published yet. Draft shifts are not used for attendance.">
          <Switch id="include-draft" checked={includeDraft} onCheckedChange={setIncludeDraft} />
          <Label htmlFor="include-draft" className="cursor-pointer text-[13px] text-slate-600">Include draft shifts</Label>
        </label>

        <div className="basis-full" />

        <div className="flex gap-1.5">
          {VIEWS.map(v => (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={cn('h-9 rounded border px-3 text-[12px] font-medium transition-all', optionCls(view === v.id))}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="Previous" onClick={stepBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[210px] text-center text-[13px] font-medium text-slate-700">
            {view === 'day' ? longDate(date) : rangeLabel(weekStart)}
          </span>
          <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="Next" onClick={stepForward}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary hover:bg-primary/5 hover:text-primary" onClick={goToday}>
            Today
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {active.dataUpdatedAt > 0 && (
            <span className="text-[11.5px] text-slate-400">Updated {clockOf(active.dataUpdatedAt)}</span>
          )}
          <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="Refresh" onClick={refresh}>
            <RefreshCw className={cn('h-4 w-4', active.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </ListFilterBar>

      {departmentId == null ? (
        <ListCard>
          <div className="p-10 text-center text-[13px] text-slate-400">No department is in your scope yet.</div>
        </ListCard>
      ) : active.isError ? (
        <TableErrorState message="Couldn't work out queue coverage." onRetry={() => active.refetch()} />
      ) : active.isLoading ? (
        <ListCard><ListLoadingSkeleton rows={8} /></ListCard>
      ) : notConfigured ? (
        <ListCard>
          <div className="p-10 text-center text-[13px] text-slate-400">
            {canEdit
              ? 'Queue planning is off for this department. Open Queue Settings to turn it on and pick which queues it staffs.'
              : 'Queue planning has not been set up for this department yet.'}
          </div>
        </ListCard>
      ) : view === 'week' ? (
        weekQ.data && <ListCard><QueueWeekBoard week={weekQ.data} dayTypes={dayTypes} onPickDay={openDay} /></ListCard>
      ) : dayQ.data && (
        <>
          <ListCard>
            <QueueDayBoard day={dayQ.data} canEdit={canEdit}
              onApply={req => overrideMut.mutate(req)}
              onClear={req => clearMut.mutate(req)} />
          </ListCard>

          {dayQ.data.warnings.length > 0 && (
            <ListCard>
              <div className="divide-y divide-slate-100">
                {dayQ.data.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 text-[12.5px]">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span className="font-medium text-slate-700">{w.queueName}</span>
                    <span className="text-slate-400">{w.start}–{w.end}</span>
                    <span className="flex-1 text-slate-600">{w.message}</span>
                  </div>
                ))}
              </div>
            </ListCard>
          )}
        </>
      )}

      {departmentId != null && (
        <QueueSettingsSheet departmentId={departmentId} open={settingsOpen} onOpenChange={setSettingsOpen} />
      )}
    </ListPageShell>
  )
}
