import { ArrowLeft, CalendarDays, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { StickyFilterBar, StickyFilterField } from '@/components/common/StickyFilterBar'

export const PERIOD_OPTIONS = [
  'Today',
  'Yesterday',
  'Current Week',
  'Prior Week',
  'Current Month',
  'Prior Month',
  'Current Quarter',
  'Prior Quarter',
  'Current Year',
  'Prior Year',
  'Custom',
] as const

export type Period = typeof PERIOD_OPTIONS[number]

interface InsightsFilterBarProps {
  selectedDepts: string[]
  onDeptsChange: (v: string[]) => void
  availableDepts?: string[]
  /** Hide the Department selector entirely (e.g. agent screens). */
  hideDeptFilter?: boolean
  /** Show an Agent/User multi-select (e.g. Agent Activity reports). */
  showUserFilter?: boolean
  selectedUsers?: string[]
  onUsersChange?: (v: string[]) => void
  availableUsers?: string[]
  period: string
  onPeriodChange: (v: string) => void
  /** Hide the Period/Date-Range selector entirely (e.g. snapshot reports). */
  hidePeriod?: boolean
  customStart?: string
  customEnd?: string
  onCustomStartChange?: (v: string) => void
  onCustomEndChange?: (v: string) => void
  showFormFilter?: boolean
  selectedForms?: string[]
  onFormsChange?: (v: string[]) => void
  availableForms?: string[]
  showBackButton?: boolean
  onBack?: () => void
  businessDays?: number
  /** Total business days in the period; when set, the current count renders "X of Y". */
  businessDaysTotal?: number
  /** Latest date with data (ISO YYYY-MM-DD); shown as "(through MM-DD-YYYY)" when set. */
  dataThroughDate?: string | null
  priorBusinessDays?: number
  /** Current period date range; rendered as "Current X to Y" in the Date Range row. */
  currentDateRange?: { start: string; end: string }
  priorDateRange?: { start: string; end: string }
  onReset?: () => void
}

export default function InsightsFilterBar({
  selectedDepts,
  onDeptsChange,
  availableDepts = [],
  hideDeptFilter = false,
  showUserFilter = false,
  selectedUsers = [],
  onUsersChange,
  availableUsers = [],
  period,
  onPeriodChange,
  hidePeriod = false,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  showFormFilter = false,
  selectedForms = [],
  onFormsChange,
  availableForms = [],
  showBackButton = false,
  onBack,
  businessDays,
  businessDaysTotal,
  dataThroughDate,
  priorBusinessDays,
  currentDateRange,
  priorDateRange,
  onReset,
}: InsightsFilterBarProps) {
  const isCustom = period === 'Custom'
  const hasInfoRow = businessDays != null || priorDateRange || currentDateRange

  // ISO (YYYY-MM-DD) -> MM-DD-YYYY, matching the Prior Date Range display.
  const fmtThrough = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return y && m && d ? `${m}-${d}-${y}` : iso
  }

  const infoRow = hasInfoRow ? (
    <>
      {businessDays != null && (
        <span className="flex items-center gap-1.5">
          <CalendarDays size={13} className="text-primary" />
          <span>Business Days:</span>
          <span className="font-medium text-slate-600">Current</span>
          <strong className="text-slate-700">
            {businessDays}{businessDaysTotal != null ? ` of ${businessDaysTotal}` : ''}
          </strong>
          {dataThroughDate ? <span className="text-slate-400">{`(through ${fmtThrough(dataThroughDate)})`}</span> : null}
          <span className="font-medium text-slate-600">Prior</span>
          <strong className="text-slate-700">{priorBusinessDays ?? '…'}</strong>
        </span>
      )}
      {(currentDateRange || priorDateRange) && (
        <span className="flex items-center gap-1.5 ml-2">
          <CalendarDays size={13} className="text-primary" />
          <span className="w-2.5 h-px bg-primary inline-block" />
          <CalendarDays size={13} className="text-primary" />
          <span className="ml-1">Date Range:</span>
          {currentDateRange && (
            <>
              <span className="font-medium text-slate-600">Current</span>
              <strong className="text-slate-700">{currentDateRange.start}</strong>
              <span className="text-slate-400">to</span>
              <strong className="text-slate-700">{currentDateRange.end}</strong>
            </>
          )}
          {priorDateRange && (
            <>
              <span className="font-medium text-slate-600">Prior</span>
              <strong className="text-slate-700">{priorDateRange.start}</strong>
              <span className="text-slate-400">to</span>
              <strong className="text-slate-700">{priorDateRange.end}</strong>
            </>
          )}
        </span>
      )}
    </>
  ) : undefined

  return (
    <StickyFilterBar infoRow={infoRow}>
      <StickyFilterBar.Row>

        {showUserFilter && (
          <StickyFilterField label="Agent">
            <StagedMultiSelect
              options={availableUsers}
              selected={selectedUsers}
              onApply={(v) => onUsersChange?.(v)}
              placeholder="All Agents"
              width="w-[220px]"
            />
          </StickyFilterField>
        )}

        {!hideDeptFilter && (
          <StickyFilterField label="Department">
            <StagedMultiSelect
              options={availableDepts}
              selected={selectedDepts}
              onApply={onDeptsChange}
              placeholder="All Departments"
              width="w-[200px]"
            />
          </StickyFilterField>
        )}

        {showFormFilter && (
          <StickyFilterField label="Form">
            <StagedMultiSelect
              options={availableForms}
              selected={selectedForms}
              onApply={(v) => onFormsChange?.(v)}
              placeholder="All Forms"
              width="w-[230px]"
            />
          </StickyFilterField>
        )}

        {!hidePeriod && (
          <StickyFilterField label="Period">
            <Select value={period} onValueChange={onPeriodChange}>
              <SelectTrigger className="h-8 text-xs w-[175px] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </StickyFilterField>
        )}

        {!hidePeriod && isCustom && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={customStart ?? ''}
              onChange={(e) => onCustomStartChange?.(e.target.value)}
              className="h-8 text-xs w-[150px] bg-white"
            />
            <span className="text-xs text-slate-400">to</span>
            <Input
              type="date"
              value={customEnd ?? ''}
              onChange={(e) => onCustomEndChange?.(e.target.value)}
              className="h-8 text-xs w-[150px] bg-white"
            />
          </div>
        )}

        <StickyFilterBar.RightCluster className="gap-2">
          {onReset && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="h-8 px-2 text-slate-500 hover:text-slate-800"
            >
              <RotateCcw size={13} className="mr-1" />
              Reset
            </Button>
          )}
          {showBackButton && onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="h-8 px-3 text-primary hover:text-primary hover:bg-primary/10"
            >
              <ArrowLeft size={14} className="mr-1" />
              Back to List
            </Button>
          )}
        </StickyFilterBar.RightCluster>

      </StickyFilterBar.Row>
    </StickyFilterBar>
  )
}
