/**
 * Shared look of a queue coverage cell, so the day board and the week board
 * colour a seat the same way. Kept out of the components themselves because
 * exporting non-component values from a component file trips react-refresh.
 */
import type { CSSProperties } from 'react'

/** Neutral language for time somebody is not on the phone, matching SEGMENT_CLS. */
export const AWAY_CLS = 'bg-slate-300'
export const OFF_CLS = 'bg-transparent'
export const IDLE_CLS = 'bg-slate-100'

/**
 * Diagonal lines laid over the queue's own colour to say "covering", so the
 * colour still reads as which queue while the hatch reads as borrowed. Dark and
 * semi-transparent so it shows on a light or a dark queue colour alike.
 */
export const COVER_STRIPES =
  'repeating-linear-gradient(45deg, rgba(0,0,0,0.34) 0, rgba(0,0,0,0.34) 2px, transparent 2px, transparent 6px)'

/** The fill for an on-queue cell: the queue colour, hatched when it is a cover. */
export function onCellStyle(color: string | undefined, isCover: boolean): CSSProperties {
  return isCover ? { backgroundColor: color, backgroundImage: COVER_STRIPES } : { backgroundColor: color }
}
