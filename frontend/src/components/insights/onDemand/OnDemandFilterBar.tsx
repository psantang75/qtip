/**
 * Sticky filter bar for the On-Demand Report view page — shared chrome with
 * `InsightsFilterBar`. Renders only the controls the report declares.
 *   Row 1: entity filters · result count + Back
 *   Row 2: period (+ custom dates) · Review # / Session # · Reset + Run
 */
import type { Dispatch, SetStateAction } from 'react'
import { ArrowLeft, Loader2, Play, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { StickyFilterBar, StickyFilterField } from '@/components/common/StickyFilterBar'
import { PERIOD_OPTIONS } from '@/components/insights/insightsFilterOptions'
import type { OnDemandFilterOptions, OnDemandReportSummary } from '@/services/onDemandReportsService'
import type { FilterState } from './onDemandFilterState'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROCESS: 'In Process',
  AWAITING_CSR_ACTION: 'Awaiting CSR Action',
  QUIZ_PENDING: 'Quiz Pending',
  COMPLETED: 'Completed',
  FOLLOW_UP_REQUIRED: 'Follow-Up Required',
  CLOSED: 'Closed',
}

const formatStatusLabel = (s: string): string =>
  STATUS_LABELS[s] || s.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())

/** Sentinel for an "all" choice — shadcn Select can't hold an empty-string value. */
const ALL = '__all__'

interface ChoiceSelectProps {
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  width: string
  /** Label for the leading "no filter" choice; omit when one value is always selected. */
  allLabel?: string
}

function ChoiceSelect({ value, onChange, options, width, allLabel }: ChoiceSelectProps) {
  const current = allLabel ? (value || ALL) : (value || options[0]?.value || '')
  return (
    <Select value={current} onValueChange={v => onChange(v === ALL ? '' : v)}>
      <SelectTrigger className={`h-8 text-xs ${width} bg-white`}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

const asChoices = (values: string[]) => values.map(v => ({ value: v, label: v }))

interface OnDemandFilterBarProps {
  meta?: OnDemandReportSummary
  draft: FilterState
  setDraft: Dispatch<SetStateAction<FilterState>>
  opts: OnDemandFilterOptions
  /** Result count to show; undefined before a run. */
  resultCount?: number
  hasFilters: boolean
  running: boolean
  onReset: () => void
  onRun: () => void
  onBack: () => void
}

export default function OnDemandFilterBar({
  meta, draft, setDraft, opts, resultCount, hasFilters, running, onReset, onRun, onBack,
}: OnDemandFilterBarProps) {
  const supported = meta?.supportedFilters ?? []
  const has = (k: (typeof supported)[number]) => supported.includes(k)
  const set = <K extends keyof FilterState>(k: K) => (v: FilterState[K]) => setDraft(d => ({ ...d, [k]: v }))
  const bandOptions = meta?.callLengthBandOptions ?? []
  const periodOptions = meta?.periodOptions ?? PERIOD_OPTIONS
  // A grouped report groups by the agent, so its agent filter is named for that column.
  const agentLabel = meta?.groupBy?.label ?? 'Agent'

  return (
    <StickyFilterBar>
      <StickyFilterBar.Row>
        {has('agents') && (
          <StickyFilterField label={agentLabel}>
            <StagedMultiSelect options={opts.agents} selected={draft.agents} onApply={set('agents')}
              placeholder={`All ${agentLabel}s`} width="w-[200px]" />
          </StickyFilterField>
        )}
        {has('departments') && (
          <StickyFilterField label="Department">
            <StagedMultiSelect options={opts.departments} selected={draft.departments} onApply={set('departments')}
              placeholder="All Departments" width="w-[200px]" />
          </StickyFilterField>
        )}
        {has('forms') && (
          <StickyFilterField label="Form">
            <StagedMultiSelect options={opts.forms} selected={draft.forms} onApply={set('forms')}
              placeholder="All Forms" width="w-[230px]" />
          </StickyFilterField>
        )}
        {has('topics') && (
          <StickyFilterField label="Training Topics">
            <StagedMultiSelect options={opts.topics} selected={draft.topics} onApply={set('topics')}
              placeholder="All Topics" width="w-[200px]" />
          </StickyFilterField>
        )}
        {has('status') && (
          <StickyFilterField label="Status">
            <ChoiceSelect value={draft.status} onChange={set('status')} width="w-[170px]" allLabel="All Statuses"
              options={opts.statuses.map(s => ({ value: s, label: formatStatusLabel(s) }))} />
          </StickyFilterField>
        )}
        {has('callLengthBand') && (
          <StickyFilterField label="Call Length">
            <ChoiceSelect value={draft.callLengthBand} onChange={set('callLengthBand')} width="w-[200px]"
              options={bandOptions} />
          </StickyFilterField>
        )}
        {has('campaign') && (
          <StickyFilterField label="Campaign">
            <ChoiceSelect value={draft.campaign} onChange={set('campaign')} width="w-[200px]"
              options={asChoices(opts.campaigns)} />
          </StickyFilterField>
        )}
        {has('declineReason') && (
          <StickyFilterField label="Decline Reason">
            <ChoiceSelect value={draft.declineReason} onChange={set('declineReason')} width="w-[220px]"
              allLabel="All Reasons" options={asChoices(opts.declineReasons)} />
          </StickyFilterField>
        )}
        {has('currency') && (
          <StickyFilterField label="Currency">
            <ChoiceSelect value={draft.currency} onChange={set('currency')} width="w-[100px]"
              options={asChoices(opts.currencies)} />
          </StickyFilterField>
        )}

        <StickyFilterBar.RightCluster>
          {resultCount !== undefined && (
            <span className="text-[12px] text-slate-500">
              <span className="font-semibold text-slate-700">{resultCount.toLocaleString()}</span> results
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onBack}
            className="h-8 px-3 text-primary hover:text-primary hover:bg-primary/10">
            <ArrowLeft size={14} className="mr-1" />
            Back to Reports
          </Button>
        </StickyFilterBar.RightCluster>
      </StickyFilterBar.Row>

      <StickyFilterBar.Row className="mt-3">
        <StickyFilterField label={meta?.periodLabel ?? 'Period'}>
          <ChoiceSelect value={draft.period} onChange={set('period')} width="w-[175px]"
            options={asChoices([...periodOptions])} />
        </StickyFilterField>

        {draft.period === 'Custom' && (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={draft.customStart} onChange={e => set('customStart')(e.target.value)}
              className="h-8 text-xs w-[150px] bg-white" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" value={draft.customEnd} onChange={e => set('customEnd')(e.target.value)}
              className="h-8 text-xs w-[150px] bg-white" />
          </div>
        )}

        {has('submissionId') && (
          <NumberSearch label="Review #" value={draft.submissionId} onChange={set('submissionId')} />
        )}
        {has('sessionId') && (
          <NumberSearch label="Session #" value={draft.sessionId} onChange={set('sessionId')} />
        )}

        <StickyFilterBar.RightCluster>
          <Button variant="ghost" size="sm" onClick={onReset} disabled={!hasFilters}
            className="h-7 px-2 text-[12px] text-primary hover:text-primary hover:bg-primary/5">
            Reset Filters
          </Button>
          <Button size="sm" onClick={onRun} disabled={running} className="h-8 text-xs">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Run
          </Button>
        </StickyFilterBar.RightCluster>
      </StickyFilterBar.Row>
    </StickyFilterBar>
  )
}

function NumberSearch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <StickyFilterField label={label}>
      <div className="relative w-[150px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <Input type="text" inputMode="numeric" pattern="[0-9]*" placeholder={label} value={value}
          onChange={e => onChange(e.target.value.replace(/\D/g, ''))} className="pl-8 h-8 text-xs bg-white" />
      </div>
    </StickyFilterField>
  )
}
