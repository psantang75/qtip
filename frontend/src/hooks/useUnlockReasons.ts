import { useQuery } from '@tanstack/react-query'
import listService, { type ListItem } from '@/services/listService'
import { UNLOCK_REASON_CODES, UNLOCK_REASON_LABELS } from '@/services/unlockService'

/**
 * Unlock/reopen reasons, sourced from the admin-managed `unlock_reason` list
 * (Admin → List Management → Quality) rather than a hardcoded array. Falls back
 * to the built-in set so the reopen dialog, the register filter, and label
 * rendering all keep working before the list is seeded or if the API is slow.
 *
 * Codes stay stable (`item_key`), so historical `record_unlock.reason_code`
 * rows still resolve to a label even after an admin renames one. Admin-added
 * items have no `item_key`, so their code is derived from the label the same
 * way `qa_form_type` does (see MetadataStep).
 */
export interface UnlockReasonOption {
  code: string
  label: string
}

const FALLBACK: UnlockReasonOption[] = UNLOCK_REASON_CODES.map((c) => ({
  code: c,
  label: UNLOCK_REASON_LABELS[c],
}))

function deriveCode(item: ListItem): string {
  return item.item_key ?? item.label.toUpperCase().replace(/\s+/g, '_')
}

export function useUnlockReasons() {
  const { data } = useQuery({
    queryKey: ['list-items', 'unlock_reason'],
    queryFn: () => listService.getItems('unlock_reason'),
    staleTime: 5 * 60 * 1000,
  })

  const options: UnlockReasonOption[] =
    data && data.length > 0 ? data.map((i) => ({ code: deriveCode(i), label: i.label })) : FALLBACK

  const labelOf = (code: string): string =>
    options.find((o) => o.code === code)?.label ??
    UNLOCK_REASON_LABELS[code as keyof typeof UNLOCK_REASON_LABELS] ??
    code

  return { options, labelOf }
}
