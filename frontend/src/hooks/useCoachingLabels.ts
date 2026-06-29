import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import listService, { type ListItem } from '@/services/listService'
import {
  COACHING_PURPOSE_LABELS,
  COACHING_FORMAT_LABELS,
  COACHING_SOURCE_LABELS,
} from '@/constants/labels'

const STALE = 5 * 60_000

/**
 * Resolve coaching purpose/format/source display labels from List Management
 * (admin-managed `list_items`). These are fully dynamic lists: the backend
 * stores `list_items.id` and read endpoints already return resolved labels, so
 * these maps mainly back legacy/fallback lookups. The hardcoded enum labels are
 * retained only as a safety fallback for any pre-migration data.
 */
function buildMap(items: ListItem[], fallback: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = { ...fallback }
  for (const i of items) if (i.item_key) map[i.item_key] = i.label
  return map
}

export function useCoachingLabels() {
  const { data: purposeItems = [] } = useQuery({
    queryKey: ['list-items', 'coaching_purpose'],
    queryFn:  () => listService.getItems('coaching_purpose'),
    staleTime: STALE,
  })
  const { data: formatItems = [] } = useQuery({
    queryKey: ['list-items', 'coaching_format'],
    queryFn:  () => listService.getItems('coaching_format'),
    staleTime: STALE,
  })
  const { data: sourceItems = [] } = useQuery({
    queryKey: ['list-items', 'coaching_source'],
    queryFn:  () => listService.getItems('coaching_source'),
    staleTime: STALE,
  })

  return useMemo(() => ({
    purposeMap: buildMap(purposeItems, COACHING_PURPOSE_LABELS),
    formatMap:  buildMap(formatItems,  COACHING_FORMAT_LABELS),
    sourceMap:  buildMap(sourceItems,  COACHING_SOURCE_LABELS),
    // Active format labels for filter dropdowns; fall back to hardcoded labels.
    formatOptions: formatItems.length
      ? formatItems.filter(i => i.is_active).map(i => i.label)
      : Object.values(COACHING_FORMAT_LABELS),
  }), [purposeItems, formatItems, sourceItems])
}
