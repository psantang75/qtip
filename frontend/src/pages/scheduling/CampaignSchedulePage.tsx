/**
 * Call Campaign Schedule — a department-scoped, month-at-a-time calendar of
 * projected call campaigns.
 *
 * A manager picks one of their department's named schedules, navigates months,
 * and sees each enabled campaign auto-placed on the right business day (via its
 * anchor rule). Clicking a day opens a grouped multi-select to tweak that day;
 * "Build" chooses which campaigns the schedule projects at all, and the publish
 * control beside it releases the month on screen — the only release control there
 * is, since the API lifts the schedule's own draft flag with it. Occurrences are
 * computed on read — moving forward is just the next month. Department scoping,
 * draft-free, is enforced server-side.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, EyeOff, Megaphone, Pencil, Plus } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import { useScheduleRole } from '@/hooks/useScheduleRole'
import { MonthCampaignGrid } from '@/components/scheduling/MonthCampaignGrid'
import { CampaignScheduleEditorDialog } from '@/components/scheduling/CampaignScheduleEditorDialog'
import { CampaignMonthNav } from '@/components/scheduling/CampaignMonthNav'
import { monthKeyOf, nearestPublishedMonth } from '@/components/scheduling/campaignMonth'
import campaignService from '@/services/campaignService'

export default function CampaignSchedulePage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  // canEdit publishes (Admin/Manager); canManage adds Director, who reads drafts
  // without releasing them — the same split the API enforces.
  const { canEdit, canManage } = useScheduleRole()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [scheduleId, setScheduleId] = useState<number | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDeptIds, setNewDeptIds] = useState<number[]>([])

  // Editors also get retired schedules, since restoring one means selecting it.
  const schedulesQ = useQuery({
    queryKey: ['campaign-schedules', canEdit],
    queryFn: () => campaignService.listSchedules(canEdit),
  })
  const deptsQ = useQuery({ queryKey: ['campaign-writable-depts'], queryFn: () => campaignService.listWritableDepartments(), enabled: canEdit })
  const deptItems = useMemo(
    () => (deptsQ.data ?? []).map(d => ({ id: d.id, label: d.department_name })),
    [deptsQ.data],
  )

  // Auto-select a schedule once loaded, preferring a live one over a retired one.
  useEffect(() => {
    const list = schedulesQ.data ?? []
    if (list.length === 0) return
    if (scheduleId != null && list.some(s => s.id === scheduleId)) return
    setScheduleId((list.find(s => s.is_active) ?? list[0]).id)
  }, [schedulesQ.data, scheduleId])

  const selected = useMemo(() => (schedulesQ.data ?? []).find(s => s.id === scheduleId) ?? null, [schedulesQ.data, scheduleId])
  const publishedMonths = selected?.published_months ?? []

  // An agent can only open a released month, so land them on one rather than on
  // a month the API would (correctly) refuse to serve.
  useEffect(() => {
    if (canManage || selected == null) return
    const months = selected.published_months
    if (months.includes(monthKeyOf(year, month))) return
    const today = new Date()
    const target = nearestPublishedMonth(months, monthKeyOf(today.getFullYear(), today.getMonth() + 1))
    if (target) { setYear(target[0]); setMonth(target[1]) }
  }, [canManage, selected, year, month])

  const monthQ = useQuery({
    queryKey: ['campaign-month', scheduleId, year, month],
    queryFn: () => campaignService.getMonth(scheduleId!, year, month),
    enabled: scheduleId != null,
  })
  const membershipQ = useQuery({
    queryKey: ['campaign-membership', scheduleId],
    queryFn: () => campaignService.getMembership(scheduleId!),
    enabled: scheduleId != null,
  })
  const enabledMembership = useMemo(() => (membershipQ.data ?? []).filter(m => m.is_enabled), [membershipQ.data])

  const toggleMut = useMutation({
    mutationFn: ({ date, itemId, isOn }: { date: string; itemId: number; isOn: boolean }) =>
      campaignService.setDayCampaign(scheduleId!, date, itemId, isOn),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaign-month', scheduleId] }),
    onError: (e) => toast(t.fromError(e)),
  })

  // Publishing a month is the only release control: the API lifts the schedule's
  // own draft flag with it, so both caches move.
  const publishMonthMut = useMutation({
    mutationFn: (isPublished: boolean) => campaignService.setMonthPublished(scheduleId!, year, month, isPublished),
    onSuccess: (_r, isPublished) => {
      qc.invalidateQueries({ queryKey: ['campaign-schedules'] })
      qc.invalidateQueries({ queryKey: ['campaign-month', scheduleId] })
      toast({ title: isPublished ? 'Month published' : 'Month unpublished' })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const createMut = useMutation({
    mutationFn: () => campaignService.createSchedule({ name: newName.trim(), department_ids: newDeptIds }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['campaign-schedules'] })
      setScheduleId(s.id); setCreateOpen(false); setNewName(''); setNewDeptIds([])
      toast({ title: 'Schedule created' })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const schedules = schedulesQ.data ?? []
  const isMonthPublished = monthQ.data?.is_published ?? false

  return (
    <ListPageShell>
      <ListPageHeader
        title="Call Campaigns"
        subtitle="Department call-campaign calendars, auto-projected from the shared library."
        actions={canEdit ? (
          <div className="flex items-center gap-2">
            {selected && (
              isMonthPublished ? (
                <Button variant="outline" size="sm" disabled={publishMonthMut.isPending}
                  onClick={() => publishMonthMut.mutate(false)}>
                  <EyeOff className="mr-1 h-4 w-4" /> Unpublish Month
                </Button>
              ) : (
                <Button variant="primary" size="sm" disabled={publishMonthMut.isPending}
                  onClick={() => publishMonthMut.mutate(true)}>
                  <CalendarCheck className="mr-1 h-4 w-4" />
                  {publishMonthMut.isPending ? 'Publishing\u2026' : 'Publish Month'}
                </Button>
              )
            )}
            <Button variant="default" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New Schedule
            </Button>
          </div>
        ) : undefined}
      />

      {/* Schedule selector + month navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          <Select value={scheduleId != null ? String(scheduleId) : ''} onValueChange={v => setScheduleId(Number(v))}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select a schedule" /></SelectTrigger>
            <SelectContent>
              {schedules.map(s => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.is_active ? s.name : `${s.name} (retired)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canEdit && selected && (
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="Edit schedule"
              onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>

        <CampaignMonthNav
          year={year}
          month={month}
          onChange={(y, m) => { setYear(y); setMonth(m) }}
          canSeeDrafts={canManage}
          publishedMonths={publishedMonths}
          isPublished={isMonthPublished}
        />
      </div>

      {schedulesQ.isLoading ? (
        <ListCard><ListLoadingSkeleton rows={6} /></ListCard>
      ) : schedules.length === 0 ? (
        <ListCard>
          <div className="p-10 text-center text-[13px] text-slate-400">
            {canEdit ? 'No campaign schedules yet. Create one to get started.' : 'No campaign schedules are available for your department yet.'}
          </div>
        </ListCard>
      ) : monthQ.isError ? (
        <TableErrorState message="Couldn't load the calendar." onRetry={() => monthQ.refetch()} />
      ) : monthQ.isLoading || !monthQ.data ? (
        <ListCard><ListLoadingSkeleton rows={6} /></ListCard>
      ) : (
        <MonthCampaignGrid
          projection={monthQ.data}
          membership={enabledMembership}
          canEdit={canEdit}
          onToggle={(date, itemId, isOn) => toggleMut.mutate({ date, itemId, isOn })}
        />
      )}

      <CampaignScheduleEditorDialog schedule={selected} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>New Campaign Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Departments</Label>
              <SearchableMultiSelect items={deptItems} selectedIds={newDeptIds} onChange={setNewDeptIds}
                placeholder="Select departments" emptyMessage="No departments in your scope" />
            </div>
            <div className="space-y-1.5">
              <Label>Schedule name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Customer Service AR" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={!newName.trim() || newDeptIds.length === 0 || createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListPageShell>
  )
}
