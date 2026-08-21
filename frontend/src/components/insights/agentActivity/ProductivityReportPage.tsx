import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import ActivityReportShell from './ActivityReportShell'
import ProductivityReport from './ProductivityReport'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getProductivityRoster, type ProductivityArea } from '@/services/insightsService'

/**
 * The Productivity report is day-scoped: one day drives the whole page from the
 * filter bar, so the collapsed roster and the drill-down tiles always describe
 * the same day (no period-vs-day mismatch, and no bespoke date picker inside the
 * drill-down like the report used to carry).
 *
 * The Period selector is the same control the rest of Insights uses, restricted
 * to a single day — Today, Yesterday, or a Custom date (one date, not a range).
 * Data is read live for the chosen day: the roster aggregates it, the drill-down
 * assembles it on expand from the punch clock, Genesys and the CRM.
 */

const PERIOD_OPTIONS = ['Today', 'Yesterday', 'Custom'] as const
const DEFAULT_PERIOD: (typeof PERIOD_OPTIONS)[number] = 'Today'

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** ISO date `days` away from today (0 = today, -1 = yesterday). */
const dayFromToday = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toISO(d)
}

interface ProductivityReportPageProps {
  title: string
  description: string
  /** First column header — "Salesperson" vs "Agent". */
  agentLabel: string
  /** Own storage key so the day picked here does not leak onto other AA reports. */
  storageKey: string
  /** Selects the section's endpoint (page grant + department subtree). */
  area: ProductivityArea
}

export default function ProductivityReportPage({
  title, description, agentLabel, storageKey, area,
}: ProductivityReportPageProps) {
  const filters = useActivityFilters(storageKey)
  const { period, setPeriod, customStart, users, departments } = filters

  // A persisted range period (e.g. a stale "Current Month") is not a single day
  // for this report, so snap it to Today.
  useEffect(() => {
    if (!(PERIOD_OPTIONS as readonly string[]).includes(period)) setPeriod(DEFAULT_PERIOD)
  }, [period, setPeriod])

  const date = useMemo(() => {
    if (period === 'Yesterday') return dayFromToday(-1)
    if (period === 'Custom')    return customStart || dayFromToday(0)
    return dayFromToday(0)
  }, [period, customStart])

  // The roster drives both the table and the filter-bar dropdowns, so the Agent
  // and Department options are the real people/teams in scope for the day (not
  // placeholders). React Query dedupes this against the identical query inside
  // ProductivityReport, so the day is fetched once.
  const { data } = useQuery({
    queryKey: ['productivity-roster', area, date],
    queryFn: () => getProductivityRoster(area, date),
  })
  const availableUsers = useMemo(
    () => [...new Set((data?.rows ?? []).map(r => r.agent))].sort((a, b) => a.localeCompare(b)),
    [data],
  )
  const availableDepts = useMemo(() => data?.departments ?? [], [data])

  return (
    <ActivityReportShell
      title={title}
      description={description}
      filters={filters}
      availableUsers={availableUsers}
      availableDepts={availableDepts}
      periodOptions={PERIOD_OPTIONS}
      singleDayCustom
      hideBusinessDays
      hideDateRange
      live
    >
      <ProductivityReport
        agentLabel={agentLabel}
        date={date}
        area={area}
        selectedUsers={users}
        selectedDepts={departments}
      />
    </ActivityReportShell>
  )
}
