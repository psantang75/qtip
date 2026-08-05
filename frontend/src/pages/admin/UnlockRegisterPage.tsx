import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { DateRangeFilter } from '@/components/common/DateRangeFilter'
import { unlockService } from '@/services/unlockService'
import { useUnlockReasons } from '@/hooks/useUnlockReasons'
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

const DEFAULT_START = isoDaysAgo(90)
const DEFAULT_END = new Date().toISOString().slice(0, 10)

// code ↔ label pairs so the multi-selects can show friendly labels while the
// query keeps sending the stored codes.
const ENTITY_OPTS = [
  { code: 'SUBMISSION', label: 'Reviews' },
  { code: 'DISPUTE', label: 'Disputes' },
]
const STATE_OPTS = [
  { code: 'OPEN', label: 'Awaiting fix' },
  { code: 'CLOSED', label: 'Corrected' },
  { code: 'AUTO_RELOCKED', label: 'Auto re-locked' },
]

const codesToLabels = (codes: string[], opts: { code: string; label: string }[]) =>
  codes.map((c) => opts.find((o) => o.code === c)?.label ?? c)
const labelsToCodes = (labels: string[], opts: { code: string; label: string }[]) =>
  labels.map((l) => opts.find((o) => o.label === l)?.code ?? l)

export default function UnlockRegisterPage() {
  const { options: reasonOpts } = useUnlockReasons()

  const [dateStart, setDateStart] = useState(DEFAULT_START)
  const [dateEnd, setDateEnd] = useState(DEFAULT_END)
  const [entityCodes, setEntityCodes] = useState<string[]>([])
  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [stateCodes, setStateCodes] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const query = useMemo(
    () => ({
      date_start: dateStart,
      date_end: dateEnd,
      entity_type: entityCodes.join(','),
      reason_code: reasonCodes.join(','),
      state: stateCodes.join(','),
      search,
      limit: 200,
    }),
    [dateStart, dateEnd, entityCodes, reasonCodes, stateCodes, search],
  )

  const { data: list, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['unlock-register', query],
    queryFn: () => unlockService.getRegister(query),
  })

  const { data: stats } = useQuery({
    queryKey: ['unlock-register-stats', query],
    queryFn: () => unlockService.getStats(query),
  })

  const hasFilters =
    entityCodes.length > 0 ||
    reasonCodes.length > 0 ||
    stateCodes.length > 0 ||
    search.trim() !== '' ||
    dateStart !== DEFAULT_START ||
    dateEnd !== DEFAULT_END

  const resetFilters = () => {
    setDateStart(DEFAULT_START)
    setDateEnd(DEFAULT_END)
    setEntityCodes([])
    setReasonCodes([])
    setStateCodes([])
    setSearch('')
  }

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

      <ListFilterBar
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ total: list?.pagination.total ?? 0 }}
      >
        {/* 1. Record type */}
        <StagedMultiSelect
          options={ENTITY_OPTS.map((o) => o.label)}
          selected={codesToLabels(entityCodes, ENTITY_OPTS)}
          onApply={(labels) => setEntityCodes(labelsToCodes(labels, ENTITY_OPTS))}
          placeholder="All records"
          width="w-[160px]"
        />

        {/* 2. Reason — sourced from the admin-managed unlock_reason list */}
        <StagedMultiSelect
          options={reasonOpts.map((o) => o.label)}
          selected={reasonCodes.map((c) => reasonOpts.find((o) => o.code === c)?.label ?? c)}
          onApply={(labels) =>
            setReasonCodes(labels.map((l) => reasonOpts.find((o) => o.label === l)?.code ?? l))
          }
          placeholder="All reasons"
          width="w-[230px]"
        />

        {/* 3. State */}
        <StagedMultiSelect
          options={STATE_OPTS.map((o) => o.label)}
          selected={codesToLabels(stateCodes, STATE_OPTS)}
          onApply={(labels) => setStateCodes(labelsToCodes(labels, STATE_OPTS))}
          placeholder="All states"
          width="w-[170px]"
        />

        {/* Line break — date + search on the second row */}
        <div className="basis-full" />

        {/* 4. Date range */}
        <DateRangeFilter
          value={{ start: dateStart, end: dateEnd }}
          onChange={(v) => { setDateStart(v.start); setDateEnd(v.end) }}
        />

        {/* 5. Search */}
        <div className="relative w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            placeholder="Search reason or person…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-[13px]"
          />
        </div>
      </ListFilterBar>

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
