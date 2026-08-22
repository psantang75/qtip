/**
 * Month-key helpers for the campaign calendar.
 *
 * Live in their own module (not `CampaignMonthNav.tsx`) so that component file
 * only exports a component — keeps Vite fast-refresh working.
 */

export const monthKeyOf = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`

export const fromKey = (key: string): [number, number] =>
  [Number(key.slice(0, 4)), Number(key.slice(5, 7))]

/** The month an agent should land on: the first released month from now, else the last. */
export function nearestPublishedMonth(publishedMonths: string[], fromNow: string): [number, number] | null {
  if (publishedMonths.length === 0) return null
  return fromKey(publishedMonths.find(m => m >= fromNow) ?? publishedMonths[publishedMonths.length - 1])
}
