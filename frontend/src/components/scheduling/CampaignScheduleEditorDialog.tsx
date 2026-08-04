/**
 * Edit one campaign schedule: its name, the departments that see it, and which
 * library campaigns it projects — the three things that define a calendar, in one
 * place, reached from the pencil beside the schedule picker.
 *
 * Name and departments are staged and saved together (the API re-points the
 * owning department for you); the campaign toggles persist as you flip them, the
 * same as they always have. Retiring hides the schedule from the picker without
 * losing its history, and an editor can restore it from the same button.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import campaignService, { type ApiCampaignSchedule } from '@/services/campaignService'
import { CampaignMembershipList } from './CampaignMembershipList'

export function CampaignScheduleEditorDialog({ schedule, open, onOpenChange }: {
  schedule: ApiCampaignSchedule | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [deptIds, setDeptIds] = useState<number[]>([])

  // Re-seed whenever the dialog opens or the picker moves to another schedule,
  // so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!open || !schedule) return
    setName(schedule.name)
    setDeptIds(schedule.departments.map(d => d.id))
  }, [open, schedule])

  const deptsQ = useQuery({
    queryKey: ['campaign-writable-depts'],
    queryFn: () => campaignService.listWritableDepartments(),
    enabled: open,
  })
  const deptItems = useMemo(
    () => (deptsQ.data ?? []).map(d => ({ id: d.id, label: d.department_name })),
    [deptsQ.data],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['campaign-schedules'] })
    qc.invalidateQueries({ queryKey: ['campaign-month', schedule?.id] })
  }

  const saveMut = useMutation({
    mutationFn: () => campaignService.updateSchedule(schedule!.id, { name: name.trim(), department_ids: deptIds }),
    onSuccess: () => { invalidate(); onOpenChange(false); toast({ title: 'Schedule updated' }) },
    onError: (e) => toast(t.fromError(e)),
  })
  const activeMut = useMutation({
    mutationFn: (isActive: boolean) => campaignService.updateSchedule(schedule!.id, { is_active: isActive }),
    onSuccess: (_r, isActive) => {
      invalidate()
      toast({ title: isActive ? 'Schedule restored' : 'Schedule retired' })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const dirty = schedule != null && (
    name.trim() !== schedule.name ||
    deptIds.length !== schedule.departments.length ||
    deptIds.some(id => !schedule.departments.some(d => d.id === id))
  )
  const busy = saveMut.isPending || activeMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit “{schedule?.name ?? ''}”</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-schedule-name">Schedule name</Label>
            <Input id="campaign-schedule-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Customer Service AR" />
          </div>

          <div className="space-y-1.5">
            <Label>Departments</Label>
            <SearchableMultiSelect items={deptItems} selectedIds={deptIds} onChange={setDeptIds}
              placeholder="Select departments" emptyMessage="No departments in your scope" />
            <p className="text-[12px] text-slate-500">
              Everyone in these departments sees this calendar once a month is published.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Campaigns</Label>
            <p className="text-[12px] text-slate-500">
              Turn one off to keep it out of this calendar. Saves as you switch it.
            </p>
            <div className="max-h-[34vh] overflow-y-auto rounded-lg border border-slate-200 p-2">
              <CampaignMembershipList scheduleId={schedule?.id ?? null} enabled={open} />
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {schedule?.is_active === false ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => activeMut.mutate(true)}>
              <RotateCcw className="mr-1 h-4 w-4" /> Restore
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => activeMut.mutate(false)}>
              <Archive className="mr-1 h-4 w-4" /> Retire
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={!dirty || !name.trim() || deptIds.length === 0 || busy}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
