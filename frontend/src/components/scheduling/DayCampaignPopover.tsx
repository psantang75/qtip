/**
 * DayCampaignPopover — the priority interface for the call-campaign calendar.
 *
 * Click a business day → a checklist grouped by category (category color dot +
 * sort order) to toggle multiple campaigns on that day. Each toggle writes an
 * ADD/REMOVE override vs the auto-generated set (handled server-side); the UI
 * just reports the desired on/off state.
 *
 * The checklist is the schedule's enabled campaigns, unioned with anything
 * already placed on the day (so a manually-added campaign can still be removed).
 */
import { useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { ApiDayChip, ApiMembershipRow } from '@/services/campaignService'

interface Row {
  campaign_item_id: number
  label: string
  category_id: number
  category_name: string
  color: string
  category_sort: number
  item_sort: number
}

export function DayCampaignPopover({ date, dateLabel, dayChips, membership, canEdit, onToggle, children }: {
  date: string
  dateLabel: string
  dayChips: ApiDayChip[]
  membership: ApiMembershipRow[]
  canEdit: boolean
  onToggle: (date: string, campaignItemId: number, isOn: boolean) => void
  children: React.ReactNode
}) {
  const onIds = useMemo(() => new Set(dayChips.map(c => c.campaign_item_id)), [dayChips])

  // Union of enabled membership + anything already on the day, sorted by
  // (category_sort, item_sort) so the list matches calendar chip order.
  const rows = useMemo<Row[]>(() => {
    const byId = new Map<number, Row>()
    for (const m of membership) {
      byId.set(m.campaign_item_id, {
        campaign_item_id: m.campaign_item_id, label: m.label, category_id: m.category_id,
        category_name: m.category_name, color: m.color, category_sort: m.category_sort, item_sort: m.item_sort,
      })
    }
    for (const c of dayChips) {
      if (!byId.has(c.campaign_item_id)) {
        byId.set(c.campaign_item_id, {
          campaign_item_id: c.campaign_item_id, label: c.label, category_id: c.category_id,
          category_name: c.category_name, color: c.color, category_sort: 9999, item_sort: 9999,
        })
      }
    }
    return [...byId.values()].sort((a, b) => a.category_sort - b.category_sort || a.item_sort - b.item_sort)
  }, [membership, dayChips])

  const groups = useMemo(() => {
    const map = new Map<number, { name: string; color: string; rows: Row[] }>()
    for (const r of rows) {
      if (!map.has(r.category_id)) map.set(r.category_id, { name: r.category_name, color: r.color, rows: [] })
      map.get(r.category_id)!.rows.push(r)
    }
    return [...map.values()]
  }, [rows])

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="text-[13px] font-semibold text-slate-800">{dateLabel}</p>
          <p className="text-[11px] text-slate-400">{canEdit ? 'Toggle campaigns for this day' : 'Campaigns on this day'}</p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {groups.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-slate-400">No campaigns enabled for this schedule.</p>
          )}
          {groups.map(g => (
            <div key={g.name} className="mb-2 last:mb-0">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{g.name}</span>
              </div>
              {g.rows.map(r => {
                const on = onIds.has(r.campaign_item_id)
                return (
                  <label key={r.campaign_item_id}
                    className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                      canEdit ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default')}>
                    <Checkbox
                      checked={on}
                      disabled={!canEdit}
                      onCheckedChange={v => canEdit && onToggle(date, r.campaign_item_id, v === true)}
                      aria-label={r.label}
                    />
                    <span className={cn('flex-1', on ? 'text-slate-700' : 'text-slate-500')}>{r.label}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
