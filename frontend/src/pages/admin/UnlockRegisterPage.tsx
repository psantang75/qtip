import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { unlockService, UNLOCK_REASON_CODES, UNLOCK_REASON_LABELS } from '@/services/unlockService'
import { UnlockKpis } from './unlock-register/UnlockKpis'
import { UnlockGrouping } from './unlock-register/UnlockGrouping'
import { UnlockRegisterTable } from './unlock-register/UnlockRegisterTable'

/**
 * Admin Unlock Register.
 *
 * Reopening a scored review is a legitimate but sensitive power, so it is
 * measured rather than merely permitted. This page is the measurement: every
 * reopen with its reason, its score impact, and who drove it.
 */

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const DEFAULT_FILTERS = {
  date_start: isoDaysAgo(90),
  date_end: new Date().toISOString().slice(0, 10),
  entity_type: 'all',
  reason_code: 'all',
  state: 'all',
  search: '',
}

export default function UnlockRegisterPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  const query = { ...filters, limit: 200 }

  const { data: list, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['unlock-register', query],
    queryFn: () => unlockService.getRegister(query),
  })

  const { data: stats } = useQuery({
    queryKey: ['unlock-register-stats', query],
    queryFn: () => unlockService.getStats(query),
  })

  const set = (patch: Partial<typeof DEFAULT_FILTERS>) => setFilters((prev) => ({ ...prev, ...patch }))
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Unlock Register</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every review and dispute decision an admin has reopened, with the reason given and what it did to the score.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">
            Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      {stats && <UnlockKpis stats={stats} />}

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <Input
          type="date"
          className="w-[160px]"
          value={filters.date_start}
          onChange={(e) => set({ date_start: e.target.value })}
        />
        <span className="text-[12px] text-muted-foreground">to</span>
        <Input
          type="date"
          className="w-[160px]"
          value={filters.date_end}
          onChange={(e) => set({ date_end: e.target.value })}
        />
        <Select value={filters.entity_type} onValueChange={(v) => set({ entity_type: v })}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            <SelectItem value="SUBMISSION">Reviews</SelectItem>
            <SelectItem value="DISPUTE">Disputes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.reason_code} onValueChange={(v) => set({ reason_code: v })}>
          <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reasons</SelectItem>
            {UNLOCK_REASON_CODES.map((c) => (
              <SelectItem key={c} value={c}>{UNLOCK_REASON_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.state} onValueChange={(v) => set({ state: v })}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="OPEN">Awaiting fix</SelectItem>
            <SelectItem value="CLOSED">Corrected</SelectItem>
            <SelectItem value="AUTO_RELOCKED">Auto re-locked</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search reason, person, form…"
          className="w-[240px]"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
        <button
          onClick={() => setFilters(DEFAULT_FILTERS)}
          disabled={isDefault}
          className="ml-auto text-[12px] font-medium text-primary hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Reset Filters
        </button>
      </div>

      {stats && <UnlockGrouping stats={stats} />}

      <UnlockRegisterTable rows={list?.data ?? []} isLoading={isLoading} />

      {list && list.pagination.total > list.data.length && (
        <p className="text-[12px] text-muted-foreground text-center">
          Showing the {list.data.length} most recent of {list.pagination.total} reopens in range. Narrow the date range
          to see the rest.
        </p>
      )}
    </div>
  )
}
