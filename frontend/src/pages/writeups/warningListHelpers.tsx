import { StatusBadge } from '@/components/common/StatusBadge'
import { IdSearchInput } from '@/components/common/IdSearchInput'
import { WRITE_UP_TYPE_LABELS } from '@/constants/labels'
import type { WriteUpType } from '@/services/writeupService'

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
