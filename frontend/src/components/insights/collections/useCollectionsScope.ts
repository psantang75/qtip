import { useRef } from 'react'
import { useStickyState } from '@/hooks/useStickyFilters'

/**
 * The campaign and currency the Collections section is looking at, held for the
 * session so every page in the section answers about the same run.
 *
 * WHY THIS EXISTS. The period already persisted — `useActivityFilters` writes it to
 * sessionStorage under the shared `collections-filters` key — but campaign and currency
 * were five separate `useState('All Declined')` / `useState('USD')` declarations, one
 * per page. So walking from Cycle Performance to Cycle Invoices kept the month and
 * silently reset the campaign, and the two pages described different populations while
 * both looking filtered. On September 2026 that showed Submission Error as 3 invoices
 * ($447) on the summary and 523 ($68,138) in the list behind it — the second figure
 * being all four campaigns, which is right for what it was actually asked.
 *
 * ONE SCOPE STRING FOR THE WHOLE SECTION, which is the point: `useStickyState` is
 * normally page-scoped, and page-scoping these is the bug. Anything filtered by
 * campaign under Insights → Collections reads it from here rather than holding its own.
 */
const SCOPE = 'insights.collections'

/** The aggregate option — the four call-ladder campaigns, and the default selection. */
export const ALL_DECLINED = 'All Declined'

/** Reporting currency. The pages show one at a time so their totals mean something. */
const DEFAULT_CURRENCY = 'USD'

export function useCollectionsScope() {
  const [campaign, setCampaign] = useStickyState(SCOPE, 'campaign', ALL_DECLINED)
  const [currency, setCurrency] = useStickyState(SCOPE, 'currency', DEFAULT_CURRENCY)
  return { campaign, setCampaign, currency, setCurrency }
}

/**
 * The campaign choices for a declined-charge page, held across refetches.
 *
 * THE LIST COMES FROM THE RESPONSE, which reads `ie_dim_collections_campaign`. It used
 * to be a hardcoded array here — a third copy of a mapping the database already owned,
 * alongside the backend's own constant, and the copies had drifted.
 *
 * The hardcoded list existed for a real reason, though, and this is what replaces that
 * reason rather than reintroducing it: on any load where `data` is undefined — the first
 * paint, and every filter change that moves the query key — the response-derived list is
 * momentarily empty, and a `Select` whose item list does not contain its own current
 * value renders blank. Remembering the last list we were given spans that gap, because
 * the choices do not change between two reads seconds apart. The seed keeps the very
 * first paint, before any response has arrived, showing the default selection rather
 * than nothing.
 */
export function useDeclinedCampaigns(fromResponse: string[] | undefined): string[] {
  const held = useRef<string[]>([ALL_DECLINED])
  if (fromResponse && fromResponse.length > 0) held.current = fromResponse
  return held.current
}
