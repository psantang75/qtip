/**
 * Registry of all on-demand reports.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * To add a new report:
 *  1. Create a new module under `services/onDemandReports/` that
 *     exports an `OnDemandReport` definition.
 *  2. Append it to the array below.
 *  3. The UI picks up the new report automatically via
 *     `listOnDemandReportsForRole`.
 */

import { analyticsRawScoresReport } from './analytics.report'
import { coachingSessionsReport } from './coaching.report'
import type { OnDemandReport } from './types'

export const ON_DEMAND_REPORTS: OnDemandReport[] = [
  analyticsRawScoresReport,
  coachingSessionsReport,
]

export function getOnDemandReport(id: string): OnDemandReport | undefined {
  return ON_DEMAND_REPORTS.find(r => r.id === id)
}

export function listOnDemandReportsForRole(role_id: number): OnDemandReport[] {
  return ON_DEMAND_REPORTS.filter(r => r.roles.includes(role_id))
}
