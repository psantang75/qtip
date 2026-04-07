import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

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
}: InsightsFilterBarProps) {
  const deptValue  = selectedDepts.length === 1 ? selectedDepts[0] : 'all'
  const formValue  = selectedForms.length === 1  ? selectedForms[0] : 'all'
  const isCustom   = period === 'Custom'

  return (
    <div className="sticky top-0 z-40 bg-slate-50 border-b border-slate-200 px-6 py-3 flex gap-3 items-center flex-wrap">

      {showBackButton && onBack && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-8 px-2 text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={14} className="mr-1" />
          Back
        </Button>
      )}

      {/* Department filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 shrink-0">Dept</span>
        <Select
          value={deptValue}
          onValueChange={(v) => onDeptsChange(v === 'all' ? [] : [v])}
        >
          <SelectTrigger className="h-8 text-xs w-[170px] bg-white">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {availableDepts.map(d => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Time period filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 shrink-0">Period</span>
        <Select value={period} onValueChange={onPeriodChange}>
          <SelectTrigger className="h-8 text-xs w-[160px] bg-white">
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
            className="h-8 text-xs w-[130px] bg-white"
          />
          <span className="text-xs text-slate-400">to</span>
          <Input
            type="date"
            value={customEnd ?? ''}
            onChange={(e) => onCustomEndChange?.(e.target.value)}
            className="h-8 text-xs w-[130px] bg-white"
          />
        </div>
      )}

      {/* Form filter — optional */}
      {showFormFilter && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 shrink-0">Form</span>
          <Select
            value={formValue}
            onValueChange={(v) => onFormsChange?.(v === 'all' ? [] : [v])}
          >
            <SelectTrigger className="h-8 text-xs w-[190px] bg-white">
              <SelectValue placeholder="All Forms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Forms</SelectItem>
              {availableForms.map(f => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
