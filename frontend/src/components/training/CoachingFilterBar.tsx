import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  COACHING_FORMAT_LABELS,
  COACHING_STATUS_LABELS,
  STATUS_LABELS,
  CLIENT_FETCH_LIMIT,
} from '@/constants/labels'

const ALL_STATUSES   = Object.keys(COACHING_STATUS_LABELS)
const STATUS_OPTIONS = ALL_STATUSES.map(s => STATUS_LABELS[s])
const FORMAT_OPTIONS = Object.values(COACHING_FORMAT_LABELS)

interface CoachingFilterBarProps {
  /** URL filter values — each page reads these from useUrlFilters */
  values: {
    statuses: string[]
    formats: string[]
    topics: string[]
    sessionId: string
    dateFrom: string
    dateTo: string
    dueToday: string
    overdue: string
  }
  /** setMany from useUrlFilters — shared callback for all filter changes */
  setMany: (patch: Record<string, string>) => void
  hasAnyFilter: boolean
  onReset: () => void
  resultTotal: number
  itemCount: number
  /** Agent filter — only shown for admin/trainer view */
  agentOptions?: string[]
  selectedAgents?: string[]
  topicOptions: string[]
}

export function CoachingFilterBar({
  values,
  setMany,
  hasAnyFilter,
  onReset,
  resultTotal,
  itemCount,
  agentOptions,
  selectedAgents,
  topicOptions,
}: CoachingFilterBarProps) {
  const allExceptClosed = useMemo(() => STATUS_OPTIONS.filter(s => s !== 'Closed' && s !== 'Canceled'), [])
  const effectiveStatuses = useMemo(
    () => values.statuses.length === 0 ? allExceptClosed : values.statuses,
    [values.statuses, allExceptClosed],
  )

  return (
    <QualityFilterBar
      hasFilters={hasAnyFilter}
      onReset={onReset}
      resultCount={{ total: resultTotal }}
      truncated={itemCount >= CLIENT_FETCH_LIMIT}
    >
      {agentOptions && selectedAgents && (
        <StagedMultiSelect
          options={agentOptions}
          selected={selectedAgents}
          onApply={v => setMany({ agents: v.join(','), page: '1' })}
          placeholder="All Agents"
          width="w-[280px]"
        />
      )}
      <StagedMultiSelect
        options={topicOptions}
        selected={values.topics}
        onApply={v => setMany({ topics: v.join(','), page: '1' })}
        placeholder="All Topics"
        width="w-[280px]"
      />
      <StagedMultiSelect
        options={FORMAT_OPTIONS}
        selected={values.formats}
        onApply={v => setMany({ formats: v.join(','), page: '1' })}
        placeholder="All Formats"
        width="w-[200px]"
      />
      <StagedMultiSelect
        options={STATUS_OPTIONS}
        selected={effectiveStatuses}
        onApply={v => {
          const isDefault = v.length === allExceptClosed.length && allExceptClosed.every(s => v.includes(s))
          setMany({ statuses: isDefault ? '' : v.join(','), page: '1' })
        }}
        placeholder="All Statuses"
        width="w-[180px]"
      />
      <div className="relative w-[150px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Session #"
          value={values.sessionId}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '')
            setMany({ sessionId: v, page: '1' })
          }}
          className="pl-8 h-9 text-[13px]"
        />
      </div>

      <div className="w-full" />
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-slate-500 shrink-0">Session</span>
        <Input type="date" value={values.dateFrom} max={values.dateTo || undefined}
          onChange={e => setMany({ from: e.target.value, page: '1' })}
          className="h-9 w-[140px]" />
        <span className="text-[12px] text-slate-400">–</span>
        <Input type="date" value={values.dateTo} min={values.dateFrom || undefined}
          onChange={e => setMany({ to: e.target.value, page: '1' })}
          className="h-9 w-[140px]" />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
        <Checkbox checked={values.dueToday === 'true'}
          onCheckedChange={v => setMany({ dueToday: v ? 'true' : '', overdue: '', page: '1' })} />
        Due Today
      </label>
      <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer select-none">
        <Checkbox checked={values.overdue === 'true'}
          onCheckedChange={v => setMany({ overdue: v ? 'true' : '', dueToday: '', page: '1' })} />
        Overdue
      </label>
    </QualityFilterBar>
  )
}

/** Shared status/format constants for use in page-level filtering logic */
export { ALL_STATUSES, STATUS_OPTIONS, FORMAT_OPTIONS }
