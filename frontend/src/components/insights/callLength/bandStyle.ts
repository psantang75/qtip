/**
 * Bucket colours for the Call Length charts, read as an escalation: neutral
 * slate for the very short calls, success green then brand blue through the
 * healthy middle, warning amber as calls stretch, danger red for the tail
 * (10-20 min at reduced opacity, 20 min+ at full) so the two longest buckets
 * stay distinguishable without leaving the QTIP palette.
 *
 * Keyed by the bucket keys the API emits in `bands`.
 */
export interface BandStyle {
  fill: string
  fillOpacity: number
}

export const BAND_STYLE: Record<string, BandStyle> = {
  u1:     { fill: '#cbd5e1', fillOpacity: 1 },
  m1_2:   { fill: '#1abc9c', fillOpacity: 1 },
  m2_5:   { fill: '#00aeef', fillOpacity: 1 },
  m5_10:  { fill: '#f39c12', fillOpacity: 1 },
  m10_20: { fill: '#e74c3c', fillOpacity: 0.55 },
  o20:    { fill: '#e74c3c', fillOpacity: 1 },
}

/** Fallback keeps an unrecognised bucket visible rather than invisible. */
export const bandStyle = (key: string): BandStyle =>
  BAND_STYLE[key] ?? { fill: '#94a3b8', fillOpacity: 1 }

/** Shared Recharts tooltip chrome, matching the sibling Agent Activity charts. */
export const TOOLTIP_STYLE = {
  fontSize: 11,
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '4px 8px',
} as const

export const AXIS_TICK = { fontSize: 10, fill: '#94a3b8' } as const
