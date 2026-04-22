import { StatusBadge } from '@/components/common/StatusBadge'
import { IdSearchInput } from '@/components/common/IdSearchInput'
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
  return <StatusBadge status={type} label={WRITE_UP_TYPE_LABELS[type] ?? type} />
}

/**
 * Thin wrapper around the shared {@link IdSearchInput} that preserves the
 * Performance Warnings module's "Warning #" placeholder. New pages should
 * import IdSearchInput directly.
 */
export function WarningIdSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <IdSearchInput value={value} onChange={onChange} placeholder="Warning #" />
}
