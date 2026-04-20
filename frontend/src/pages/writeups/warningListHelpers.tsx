import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  WRITE_UP_TYPE_LABELS,
  WRITE_UP_STATUS_LABELS,
} from '@/constants/labels'
import type { WriteUpType, WriteUpStatus } from '@/services/writeupService'

export const ALL_STATUSES      = Object.keys(WRITE_UP_STATUS_LABELS) as WriteUpStatus[]
export const ALL_STATUS_LABELS = Object.values(WRITE_UP_STATUS_LABELS)
export const ALL_TYPES         = Object.keys(WRITE_UP_TYPE_LABELS) as WriteUpType[]
export const ALL_TYPE_LABELS   = ALL_TYPES.map(t => WRITE_UP_TYPE_LABELS[t])
export const CLOSED_LABEL      = WRITE_UP_STATUS_LABELS['CLOSED']

export function WriteUpTypeBadge({ type }: { type: WriteUpType }) {
  return <span className="text-[13px] text-slate-600">{WRITE_UP_TYPE_LABELS[type] ?? type}</span>
}

export function WarningIdSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-[150px]">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="Warning #"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        className="pl-8 h-9 text-[13px]"
      />
    </div>
  )
}
