/**
 * Which library campaigns a schedule projects, grouped by category (color dot +
 * sort). A fresh schedule includes every active campaign; the manager turns off
 * the ones that don't apply. Each toggle persists immediately and re-projects the
 * month, so this list has no save step of its own — it lives inside the schedule
 * editor next to the fields that do.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Switch } from '@/components/ui/switch'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import campaignService, { type ApiMembershipRow } from '@/services/campaignService'

export function CampaignMembershipList({ scheduleId, enabled }: {
  scheduleId: number | null
  /** Skip the fetch while the host dialog is closed. */
  enabled: boolean
}) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['campaign-membership', scheduleId],
    queryFn: () => campaignService.getMembership(scheduleId!),
    enabled: enabled && scheduleId != null,
  })

  const setMut = useMutation({
    mutationFn: ({ itemId, isEnabled }: { itemId: number; isEnabled: boolean }) =>
      campaignService.setMembership(scheduleId!, itemId, isEnabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign-membership', scheduleId] })
      qc.invalidateQueries({ queryKey: ['campaign-month', scheduleId] })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const groups = useMemo(() => {
    const map = new Map<number, { name: string; color: string; rows: ApiMembershipRow[] }>()
    for (const r of rows) {
      if (!map.has(r.category_id)) map.set(r.category_id, { name: r.category_name, color: r.color, rows: [] })
      map.get(r.category_id)!.rows.push(r)
    }
    return [...map.values()]
  }, [rows])

  if (isLoading) return <ListLoadingSkeleton rows={4} />
  if (groups.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-slate-400">
        No campaigns in the library yet. Add them in List Management.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map(g => (
        <div key={g.name}>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{g.name}</span>
          </div>
          <div className="space-y-1">
            {g.rows.map(r => (
              <div key={r.campaign_item_id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50">
                <span className="text-[13px] text-slate-700">{r.label}</span>
                <Switch checked={r.is_enabled}
                  onCheckedChange={v => setMut.mutate({ itemId: r.campaign_item_id, isEnabled: v })}
                  aria-label={`Toggle ${r.label}`} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
