import { useQuery } from '@tanstack/react-query'
import { getKpiConfig } from '@/services/insightsService'
import { KPI_DEFS, type KpiDef, type KpiDirection } from '@/constants/kpiDefs'
import type { KpiConfig, KpiConfigEntry } from '@/services/insightsService'

export type { KpiConfig, KpiConfigEntry }

/**
 * Loads live KPI definitions + thresholds from ie_kpi / ie_kpi_threshold.
 * Falls back to the static kpiDefs.ts values when the API hasn't loaded yet.
 * staleTime = 5 min — config rarely changes mid-session.
 */
export function useKpiConfig() {
  return useQuery({
    queryKey: ['ie-kpi-config'],
    queryFn:  getKpiConfig,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Returns thresholds for a single KPI code, merging live DB values over
 * the static kpiDefs.ts fallback. Safe to call before the query resolves.
 */
export function resolveThresholds(
  code: string,
  liveConfig: KpiConfig | undefined,
): Pick<KpiDef, 'direction' | 'goal' | 'warn' | 'crit'> {
  const live     = liveConfig?.[code]
  const fallback = KPI_DEFS[code]
  return {
    goal:      live?.goal      ?? fallback?.goal,
    warn:      live?.warn      ?? fallback?.warn,
    crit:      live?.crit      ?? fallback?.crit,
    direction: (live?.direction as KpiDirection | undefined) ?? fallback?.direction ?? 'NEUTRAL',
  }
}
