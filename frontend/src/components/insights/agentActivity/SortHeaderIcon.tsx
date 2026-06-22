import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

interface SortHeaderIconProps {
  /** Current sort direction for this column, or false when unsorted. */
  sorted: false | 'asc' | 'desc'
  /** Whether the column is sortable (controls whether the neutral icon shows). */
  canSort?: boolean
  size?: number
}

/**
 * Shared 3-state sort affordance for table headers and the QTIP sorting
 * convention reference: every sortable-but-unsorted column shows a neutral
 * up/down chevron (ChevronsUpDown), replaced by a single directional
 * ChevronUp/ChevronDown once the column is the active sort. Non-sortable
 * columns render nothing.
 */
export default function SortHeaderIcon({ sorted, canSort = true, size = 12 }: SortHeaderIconProps) {
  if (sorted === 'asc') return <ChevronUp size={size} />
  if (sorted === 'desc') return <ChevronDown size={size} />
  if (!canSort) return null
  return <ChevronsUpDown size={size} className="opacity-40" />
}
