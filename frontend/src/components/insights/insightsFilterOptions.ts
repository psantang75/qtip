/**
 * Period dropdown choices for the Insights filter bar.
 *
 * Lives in its own module (not `InsightsFilterBar.tsx`) so that component file
 * only exports a component — keeps Vite fast-refresh working.
 */
export const PERIOD_OPTIONS = [
  'Today',
  'Yesterday',
  'Current Week',
  'Prior Week',
  'Current Month',
  'Prior Month',
  'Current Quarter',
  'Prior Quarter',
  'Current Year',
  'Prior Year',
  'Custom',
] as const

export type Period = typeof PERIOD_OPTIONS[number]

/**
 * Period choices for the Collections Campaign × Touch report, which is scoped by
 * CAMPAIGN START rather than by activity date: the selection picks the month the
 * dunning campaign was raised in, and the report then follows that cohort to the
 * end of its cadence even when it runs into the following month.
 *
 * Month grain only — a week or a single day would cut a campaign mid-cadence and
 * produce a partial lifecycle, which is the whole thing this report exists to avoid.
 */
export const CAMPAIGN_START_OPTIONS = [
  'Current Month',
  'Prior Month',
  'Current Quarter',
  'Prior Quarter',
  'Current Year',
  'Custom',
] as const

/*
 * The declined-charge campaign choices used to be a fixed list here. They now come from
 * the response, which reads `ie_dim_collections_campaign` — see `useDeclinedCampaigns`
 * in `components/insights/collections/useCollectionsScope.ts`, which also handles the
 * refetch gap that made a fixed list attractive in the first place.
 */
