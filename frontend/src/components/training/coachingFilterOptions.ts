import {
  COACHING_FORMAT_LABELS,
  COACHING_STATUS_LABELS,
  STATUS_LABELS,
} from '@/constants/labels'

export const ALL_STATUSES   = Object.keys(COACHING_STATUS_LABELS)
export const STATUS_OPTIONS = ALL_STATUSES.map(s => STATUS_LABELS[s])
export const FORMAT_OPTIONS = Object.values(COACHING_FORMAT_LABELS)
