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
