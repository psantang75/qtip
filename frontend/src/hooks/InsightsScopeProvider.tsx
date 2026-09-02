import { type ReactNode } from 'react'
import { InsightsScopeContext, SCOPES, type InsightsScope } from './useInsightsScope'

/**
 * Binds a subtree to an Insights scope (`qc` or `ir`). Kept in its own file so
 * the hook module stays component-free for React Fast Refresh — mirrors the
 * provider/hook split in `contexts/AuthContext`.
 */
export function InsightsScopeProvider({ scope, children }: { scope: InsightsScope; children: ReactNode }) {
  return (
    <InsightsScopeContext.Provider value={SCOPES[scope]}>
      {children}
    </InsightsScopeContext.Provider>
  )
}
