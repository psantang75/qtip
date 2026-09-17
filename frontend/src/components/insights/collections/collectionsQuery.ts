import { keepPreviousData } from '@tanstack/react-query'

/**
 * Shared TanStack Query options for the Collections Insights reports.
 *
 * WHY `keepPreviousData`. Campaign, currency, decline reason and page are all in
 * these pages' query keys, so changing any one of them starts a new cache entry
 * and `data` goes `undefined` until the fetch lands. Every panel on the page is
 * written as `data?.x ?? <empty>`, so that moment renders as zeros, empty tables
 * and a vanished currency picker — the page looked broken rather than busy, and
 * on a report that took seconds to answer it looked broken for seconds. Holding
 * the previous response keeps the last good numbers on screen while the new ones
 * load; `isFetching` is what tells the reader they are looking at the old figures.
 *
 * WHY NOT `staleTime: 0`. These pages used to force a refetch on every mount, so
 * navigating Cycle Performance → Cycle Invoices → back paid the full query cost
 * three times for data that only changes when the ingestion pipeline runs. The
 * app-wide 5-minute default in `app/queryClient.ts` is well inside the source
 * reports' own cadence, so it cannot serve data from before the last run by more
 * than that. Genuine freshness is handled two other ways and neither is affected:
 * `InsightsSection` stamps the producing job's `lastUpdated`, and the pages poll
 * every 10s while `pipelineLoading` is true.
 */
export const collectionsQueryOptions = {
  placeholderData: keepPreviousData,
} as const
