import { createContext, useContext, useMemo } from 'react'
import { createInsightsApi, type InsightsApi } from '@/services/insightsQCService'

/**
 * Insights dashboard scope.
 *
 * The QC dashboards (Overview / Quality / Agent Performance) are reused verbatim
 * for the "Internal Research" section — the only differences are the API base
 * path (INTERNAL-scoped `/insights/ir` vs standard `/insights/qc`), the TanStack
 * query-key prefix (so the two scopes never share cache entries), and the route
 * base used for in-page navigation. This context carries those three so a single
 * set of page components serves both surfaces with zero duplication.
 *
 * The provider component lives in `InsightsScopeProvider.tsx` so this file only
 * exports hooks/values (keeps React Fast Refresh happy — same split as
 * `contexts/AuthContext`).
 */
export type InsightsScope = 'qc' | 'ir'

export interface ScopeValue {
  scope: InsightsScope
  apiBase: string
  keyPrefix: string
  routeBase: string
}

export const SCOPES: Record<InsightsScope, ScopeValue> = {
  qc: { scope: 'qc', apiBase: '/insights/qc', keyPrefix: 'qc', routeBase: '/app/insights/qc-' },
  ir: { scope: 'ir', apiBase: '/insights/ir', keyPrefix: 'ir', routeBase: '/app/insights/ir-' },
}

export const InsightsScopeContext = createContext<ScopeValue>(SCOPES.qc)

export function useInsightsScope(): ScopeValue {
  return useContext(InsightsScopeContext)
}

/** Dashboard API bound to the current scope's base path. */
export function useInsightsApi(): InsightsApi {
  const { apiBase } = useInsightsScope()
  return useMemo(() => createInsightsApi(apiBase), [apiBase])
}

/**
 * Scope-prefixed TanStack query-key builder. `k('kpis', params)` yields
 * `['qc','kpis',params]` or `['ir','kpis',params]` so QC and Internal Research
 * caches stay isolated.
 */
export function useScopedKey(): (...parts: unknown[]) => unknown[] {
  const { keyPrefix } = useInsightsScope()
  return useMemo(() => (...parts: unknown[]) => [keyPrefix, ...parts], [keyPrefix])
}
