import { ArrowLeft, CalendarDays, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'

export const PERIOD_OPTIONS = [
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
  period: string
  onPeriodChange: (v: string) => void
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
  priorBusinessDays?: number
  priorDateRange?: { start: string; end: string }
  onReset?: () => void
}

export default function InsightsFilterBar({
  selectedDepts,
  onDeptsChange,
  availableDepts = [],
  period,
  onPeriodChange,
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
  priorBusinessDays,
  priorDateRange,
  onReset,
}: InsightsFilterBarProps) {
  const isCustom = period === 'Custom'
  const hasInfoRow = businessDays != null || priorDateRange

  return (
    <div className="sticky -top-6 z-40 bg-slate-50 border-b border-slate-200 px-6 py-3 -mx-6 -mt-6 mb-5">

      {/* Row 1: Filters */}
      <div className="flex gap-3 items-center flex-wrap">

        {/* Department filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 shrink-0">Department</span>
          <StagedMultiSelect
            options={availableDepts}
            selected={selectedDepts}
            onApply={onDeptsChange}
            placeholder="All Departments"
            width="w-[200px]"
          />
        </div>

        {/* Form filter */}
        {showFormFilter && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 shrink-0">Form</span>
            <StagedMultiSelect
              options={availableForms}
              selected={selectedForms}
              onApply={(v) => onFormsChange?.(v)}
              placeholder="All Forms"
              width="w-[230px]"
            />
          </div>
        )}

        {/* Time period filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 shrink-0">Period</span>
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
        </div>

        {/* Custom date range */}
        {isCustom && (
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

        {/* Right-side actions */}
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>

      {/* Row 2: Business days + prior date range */}
      {hasInfoRow && (
        <div className="flex gap-10 items-center mt-4 pt-3 border-t border-slate-200 text-xs text-slate-500">
          {businessDays != null && (
            <span className="flex items-center gap-1.5">
              <CalendarDays size={13} className="text-primary" />
              Business Days: <strong className="text-slate-700">{businessDays}</strong> current,{' '}
              <strong className="text-slate-700">{priorBusinessDays ?? '…'}</strong> prior
            </span>
          )}
          {priorDateRange && (
            <span className="flex items-center gap-1.5 ml-2">
              <CalendarDays size={13} className="text-primary" />
              <span className="w-2.5 h-px bg-primary inline-block" />
              <CalendarDays size={13} className="text-primary" />
              <span className="ml-1">Prior Date Range:</span>
              <strong className="text-slate-700">{priorDateRange.start}</strong>
              <span className="text-slate-400">to</span>
              <strong className="text-slate-700">{priorDateRange.end}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
