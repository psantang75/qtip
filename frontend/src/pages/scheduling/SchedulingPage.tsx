/**
 * Scheduling calendar — the editor grid for managers and admins.
 *
 * Three views over the same schedule:
 *   Day    — one day on an hour axis; the only view that shows break/lunch
 *            collisions, because overlap is only visible on a shared time axis.
 *   Week   — the default. Seven days, the surface for building and editing.
 *   Period — two weeks, the pay-period overview and department exception list.
 *
 * Reads come from /api/scheduling/grid (adapted to the grid components' shape);
 * writes go through schedulingService and invalidate the grid query. Draft
 * visibility, locking and department scoping are enforced server-side — the UI
 * only reflects them.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, LayoutTemplate } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import { cn } from '@/lib/utils'

import { ScheduleGrid } from '@/components/scheduling/ScheduleGrid'
import { ScheduleDayTimeline } from '@/components/scheduling/ScheduleDayTimeline'
import { ShiftEditorSheet } from '@/components/scheduling/ShiftEditorSheet'
import { TemplateBuilderDialog } from '@/components/scheduling/TemplateBuilderDialog'
import { TemplateLibraryDialog } from '@/components/scheduling/TemplateLibraryDialog'
import { ApplyScheduleDialog, type ApplyMode } from '@/components/scheduling/ApplyScheduleDialog'
import { BulkActionBar } from '@/components/scheduling/BulkActionBar'
import { BulkExceptionDialog } from '@/components/scheduling/BulkExceptionDialog'
import { ExceptionSummary } from '@/components/scheduling/ExceptionSummary'
import { ScheduleLegend } from '@/components/scheduling/ScheduleLegend'
import {
  addDays, parseLocal, startOfWeek, toLocalIso,
  type MockBreak, type MockException, type MockTemplate,
} from '@/components/scheduling/mockScheduleData'
import { minutesOf, rangeStatus, type CoverageWindow } from '@/components/scheduling/scheduleTime'
import { useScheduleGrid } from '@/hooks/useScheduleGrid'
import { useScheduleTemplates } from '@/hooks/useScheduleTemplates'
import { useScheduleRole } from '@/hooks/useScheduleRole'
import schedulingService from '@/services/schedulingService'

const UNASSIGNED = 'Unassigned'
type ViewMode = 'day' | 'week' | 'period'

/** One drawer save: the shift itself plus the day's exception diff. */
interface DaySave {
  userId: number
  date: string
  start: string
  end: string
  breaks: MockBreak[]
  exceptionAdds: MockException[]
  exceptionRemoveIds: number[]
}

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'period', label: '2 Weeks' },
]

/** Canonical QTIP segmented-control styling — see formRendererComponents. */
const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]'

export default function SchedulingPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { canEdit } = useScheduleRole()

  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(startOfWeek(toLocalIso(new Date())))
  const [day, setDay] = useState(toLocalIso(new Date()))
  const [departments, setDepartments] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [search, setSearch] = useState('')
  // Unassigned users (no department) are admin-only noise on most days, so they
  // are hidden until explicitly toggled on.
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [builder, setBuilder] = useState<{ template?: MockTemplate; readOnly?: boolean } | null>(null)
  const [applyMode, setApplyMode] = useState<ApplyMode | null>(null)
  const [bulkExceptionOpen, setBulkExceptionOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ personId: number; date: string } | null>(null)

  const today = toLocalIso(new Date())

  const displayedDates = useMemo(() => {
    if (view === 'day') return [day]
    return Array.from({ length: view === 'week' ? 7 : 14 }, (_, i) => addDays(anchor, i))
  }, [view, day, anchor])

  const from = displayedDates[0]
  const to = displayedDates[displayedDates.length - 1]

  const grid = useScheduleGrid(from, to)
  const allPeople = grid.data?.people ?? []
  const deptOptions = useMemo(
    () => [...new Set(allPeople.map(p => p.department ?? UNASSIGNED))].sort(),
    [allPeople],
  )
  const personOptions = useMemo(() => allPeople.map(p => p.name).sort(), [allPeople])

  const templatesQ = useScheduleTemplates()
  const activityTypesQ = useQuery({
    queryKey: ['schedule-activity-types'],
    queryFn: () => schedulingService.listActivityTypes(false),
  })
  const coverageQ = useQuery({
    queryKey: ['schedule-coverage-thresholds'],
    queryFn: () => schedulingService.listCoverageThresholds(),
  })
  const coverageByDept = useMemo(() => {
    const m = new Map<string, { enabled: boolean; windows: CoverageWindow[] }>()
    for (const c of coverageQ.data ?? []) {
      // Configured time frames win; a department with none falls back to a
      // single all-day window from its flat green/yellow, so today's behavior
      // is preserved until frames are added.
      const windows: CoverageWindow[] = c.windows.length
        ? c.windows.map(w => ({ startMin: minutesOf(w.start), endMin: minutesOf(w.end), green: w.green_min, yellow: w.yellow_min }))
        : [{ startMin: 0, endMin: 24 * 60, green: c.green_min, yellow: c.yellow_min }]
      m.set(c.department_name, { enabled: c.is_enabled, windows })
    }
    return m
  }, [coverageQ.data])

  const invalidateGrid = () => qc.invalidateQueries({ queryKey: ['schedule-grid'] })

  const applyMut = useMutation({
    mutationFn: schedulingService.apply,
    onSuccess: (r) => { invalidateGrid(); toast({ title: 'Schedule applied', description: `${r.write} shifts written.` }) },
    onError: (e) => toast(t.fromError(e)),
  })
  const publishMut = useMutation({
    mutationFn: (confirmElapsed: boolean) =>
      schedulingService.publish({ user_ids: [...selectedIds], dates: displayedDates, confirm_elapsed: confirmElapsed }),
    onSuccess: () => { invalidateGrid(); toast({ title: 'Published' }) },
  })
  const bulkExcMut = useMutation({
    mutationFn: schedulingService.bulkException,
    onSuccess: (r) => { invalidateGrid(); toast({ title: 'Exceptions logged', description: `${r.write} written, ${r.conflict + r.unscheduled + r.outside} skipped.` }) },
    onError: (e) => toast(t.fromError(e)),
  })
  // The drawer saves the shift and the day's exceptions together, so it is one
  // mutation rather than three: a partial save that wrote the shift but dropped
  // the exception is worse than a clean failure.
  const shiftMut = useMutation({
    mutationFn: async ({ userId, date, start, end, breaks, exceptionAdds, exceptionRemoveIds }: DaySave) => {
      await schedulingService.upsertShift({
        user_id: userId,
        shift_date: date,
        is_day_off: false,
        start, end,
        segments: breaks
          .map(b => ({ activity_type_id: activityId(b.kind) ?? 0, start: b.start, end: b.end }))
          .filter(s => s.activity_type_id > 0),
      })
      // Removals first, so freeing a window lets a replacement land on the same
      // hours in the same save without tripping the overlap guard.
      for (const id of exceptionRemoveIds) await schedulingService.deleteException(id)
      for (const ex of exceptionAdds) {
        await schedulingService.createException({
          user_id: userId,
          exception_date: date,
          exception_type_id: ex.exceptionTypeId,
          is_full_day: ex.isFullDay,
          start: ex.isFullDay ? null : ex.start ?? null,
          end: ex.isFullDay ? null : ex.end ?? null,
        })
      }
      return { added: exceptionAdds.length, removed: exceptionRemoveIds.length }
    },
    onSuccess: (r) => {
      invalidateGrid()
      const parts = [
        r.added > 0 ? `${r.added} exception${r.added === 1 ? '' : 's'} added` : null,
        r.removed > 0 ? `${r.removed} removed` : null,
      ].filter(Boolean)
      toast({ title: 'Shift saved', ...(parts.length ? { description: parts.join(', ') + '.' } : {}) })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const hasUnassigned = useMemo(() => allPeople.some(p => !p.department), [allPeople])

  const visible = useMemo(() => {
    let rows = allPeople
    if (!showUnassigned) rows = rows.filter(p => !!p.department)
    if (departments.length) rows = rows.filter(p => departments.includes(p.department ?? UNASSIGNED))
    if (people.length) rows = rows.filter(p => people.includes(p.name))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(p => p.name.toLowerCase().includes(q))
    }
    return rows
  }, [allPeople, showUnassigned, departments, people, search])

  /** Selection only ever refers to rows you can currently see. */
  useEffect(() => {
    setSelectedIds(prev => {
      const allowed = new Set(visible.map(p => p.id))
      const next = new Set([...prev].filter(id => allowed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visible])

  const setSelection = (ids: number[], on: boolean) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })

  const selectedPeople = visible.filter(p => selectedIds.has(p.id))

  const staleDraftCount = useMemo(() => {
    const seen = new Set<number>()
    for (const p of allPeople) {
      for (const s of p.shifts) if (s.status === 'DRAFT' && s.date <= today) seen.add(p.id)
    }
    return seen.size
  }, [allPeople, today])

  const step = view === 'day' ? 1 : view === 'week' ? 7 : 14
  const shift = (dir: 1 | -1) => {
    if (view === 'day') setDay(d => addDays(d, dir * step))
    else setAnchor(a => addDays(a, dir * step))
  }
  const goToday = () => { setDay(today); setAnchor(startOfWeek(today)) }

  const rangeLabel = useMemo(() => {
    if (view === 'day') {
      return parseLocal(day).toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
      })
    }
    const span = view === 'week' ? 6 : 13
    const start = parseLocal(anchor)
    const end = parseLocal(addDays(anchor, span))
    const startFmt = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const endFmt = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${startFmt} \u2013 ${endFmt}`
  }, [view, day, anchor])

  const editingPerson = editing ? allPeople.find(p => p.id === editing.personId) : undefined
  const editingShift = editingPerson?.shifts.find(s => s.date === editing?.date)
  const editingExceptions = editingPerson?.exceptions.filter(e => e.date === editing?.date) ?? []

  const hasFilters = departments.length > 0 || people.length > 0 || search.trim().length > 0
  const hasSelection = selectedPeople.length > 0

  const bulkState = rangeStatus(hasSelection ? selectedPeople : visible, displayedDates, today)
  const bulkBlock = bulkState === 'locked'
    ? 'This range is published and has already elapsed, so it is locked.'
    : bulkState === 'published'
      ? 'This range is published. Unpublish it to rebuild, or move to a later week.'
      : null
  const canPublish = bulkState === 'draft' || bulkState === 'mixed'

  const activityId = (kind: MockBreak['kind']) =>
    activityTypesQ.data?.find(a => a.label.toLowerCase() === (kind === 'LUNCH' ? 'lunch' : 'break'))?.id

  const onSaveShift = async (payload: Omit<DaySave, 'userId' | 'date'>) => {
    if (!editing) return
    await shiftMut.mutateAsync({ ...payload, userId: editing.personId, date: editing.date })
  }

  const onPublish = async () => {
    try {
      await publishMut.mutateAsync(false)
    } catch (err) {
      const e = err as { response?: { data?: { code?: string } } }
      if (e.response?.data?.code === 'CONFIRM_ELAPSED'
        && window.confirm('This range has already passed. Publishing adds those days to attendance history. Continue?')) {
        await publishMut.mutateAsync(true)
      } else {
        toast(t.fromError(err))
      }
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <ListPageShell>
        <ListPageHeader
          title="Scheduling"
          subtitle="Post shifts, breaks and lunches, and log attendance exceptions."
          headerBadge={
            staleDraftCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {staleDraftCount} unpublished {staleDraftCount === 1 ? 'week' : 'weeks'} already started
              </span>
            ) : undefined
          }
          actions={
            canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
                <LayoutTemplate className="mr-1 h-4 w-4" /> Templates
              </Button>
            ) : undefined
          }
        />

        <ListFilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={'Search employee\u2026'}
          hasFilters={hasFilters}
          onReset={() => { setDepartments([]); setPeople([]); setSearch('') }}
          resultCount={{ filtered: visible.length, total: allPeople.length }}
        >
          <StagedMultiSelect
            options={deptOptions}
            selected={departments}
            onApply={setDepartments}
            placeholder="All Departments"
            width="w-[220px]"
          />
          <StagedMultiSelect
            options={personOptions}
            selected={people}
            onApply={setPeople}
            placeholder="All Employees"
            width="w-[210px]"
          />

          {hasUnassigned && (
            <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[13px] text-slate-600">
              <Checkbox
                checked={showUnassigned}
                onCheckedChange={v => setShowUnassigned(v === true)}
                aria-label="Show unassigned users"
              />
              Show Unassigned Users
            </label>
          )}

          <div className="basis-full" />

          <div className="flex gap-1.5">
            {VIEWS.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn('h-9 rounded border px-3 text-[12px] font-medium transition-all', optionCls(view === v.id))}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => shift(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[210px] text-center text-[13px] font-medium text-slate-700">{rangeLabel}</span>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => shift(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary hover:bg-primary/5 hover:text-primary" onClick={goToday}>
              Today
            </Button>
          </div>
        </ListFilterBar>

        {canEdit && (
          <BulkActionBar
            selectedCount={selectedPeople.length}
            visibleCount={visible.length}
            rangeLabel={rangeLabel}
            blockedReason={bulkBlock}
            onClear={() => setSelectedIds(new Set())}
            onStart={setApplyMode}
            onAddException={() => setBulkExceptionOpen(true)}
            onPublish={onPublish}
            canPublish={canPublish && !bulkBlock}
            publishing={publishMut.isPending}
          />
        )}

        {grid.isError ? (
          <TableErrorState message="Couldn't load the schedule." onRetry={() => grid.refetch()} />
        ) : grid.isLoading ? (
          <ListCard><ListLoadingSkeleton rows={8} /></ListCard>
        ) : (
          <ListCard>
            {view === 'day' ? (
              <ScheduleDayTimeline
                people={visible}
                date={day}
                onEditShift={(personId, date) => canEdit && setEditing({ personId, date })}
                selected={selectedIds}
                onSelect={setSelection}
                coverage={coverageByDept}
              />
            ) : (
              <ScheduleGrid
                people={visible}
                variant={view === 'week' ? 'week' : 'period'}
                weekStarts={view === 'week' ? [anchor] : [anchor, addDays(anchor, 7)]}
                onEditShift={(personId, date) => canEdit && setEditing({ personId, date })}
                selected={selectedIds}
                onSelect={setSelection}
                coverage={coverageByDept}
              />
            )}
          </ListCard>
        )}

        <ScheduleLegend
          className="px-1"
          showCoverage={view === 'day' || [...coverageByDept.values()].some(c => c.enabled)}
        />

        {view === 'period' && (
          <ExceptionSummary people={visible} from={anchor} to={addDays(anchor, 13)} />
        )}

        <ShiftEditorSheet
          open={!!editing}
          onOpenChange={o => !o && setEditing(null)}
          personName={editingPerson?.name}
          date={editing?.date}
          shift={editingShift}
          exceptions={editingExceptions}
          onSave={canEdit ? onSaveShift : undefined}
          saving={shiftMut.isPending}
        />

        <TemplateLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          onNew={() => { setLibraryOpen(false); setBuilder({}) }}
          onEdit={t => { setLibraryOpen(false); setBuilder({ template: t }) }}
          onView={t => { setLibraryOpen(false); setBuilder({ template: t, readOnly: true }) }}
        />

        <TemplateBuilderDialog
          open={!!builder}
          onOpenChange={o => { if (!o) { setBuilder(null); setLibraryOpen(true) } }}
          template={builder?.template}
          readOnly={builder?.readOnly}
        />

        <BulkExceptionDialog
          open={bulkExceptionOpen}
          onOpenChange={setBulkExceptionOpen}
          people={selectedPeople}
          defaultDate={view === 'day' ? day : today >= anchor && today <= addDays(anchor, 13) ? today : anchor}
          submitting={bulkExcMut.isPending}
          onConfirm={canEdit ? async ({ from, to, exceptionTypeId, isFullDay, start, end }) => {
            await bulkExcMut.mutateAsync({
              user_ids: selectedPeople.map(p => p.id),
              from, to, exception_type_id: exceptionTypeId, is_full_day: isFullDay,
              start: isFullDay ? null : start, end: isFullDay ? null : end,
            })
          } : undefined}
        />

        <ApplyScheduleDialog
          open={!!applyMode}
          onOpenChange={o => !o && setApplyMode(null)}
          mode={applyMode ?? 'template'}
          people={selectedPeople}
          view={view}
          day={day}
          anchor={anchor}
          templates={templatesQ.data}
          submitting={applyMut.isPending}
          onConfirm={canEdit ? async ({ mode, dates, templateId, sourceWeekStart }) => {
            await applyMut.mutateAsync({
              mode, dates, user_ids: selectedPeople.map(p => p.id),
              template_id: templateId, source_week_start: sourceWeekStart,
            })
          } : undefined}
        />
      </ListPageShell>
    </TooltipProvider>
  )
}
