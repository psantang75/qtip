/**
 * Data access for Insights → Sales Agent Activity → Missed Opportunities.
 *
 * Live wiring against `/api/insights/agent-activity/missed-opportunities/*`.
 * Reads use the page grant; rule/threshold writes and the manual re-run are
 * Admin-only server-side, so the UI hides those controls but the server is the
 * actual gate.
 */
import { api } from './authService'
import type { ActivityParams } from '@/hooks/useActivityFilters'
import type {
  CreateRuleInput,
  MissedOpportunityResponse,
  MissedOpportunityRule,
  MissedOpportunityRulesResponse,
  MissedOpportunityRunStatus,
  MissedOpportunitySettings,
  RunStartResult,
  UpdateRuleInput,
} from '@/types/missedOpportunities'

const BASE = '/insights/agent-activity/missed-opportunities'

export interface MissedOpportunityQuery extends ActivityParams {
  /** Comma-separated rule keys. */
  rules?: string
  /** Comma-separated severities. */
  severities?: string
}

export async function getMissedOpportunities(
  params: MissedOpportunityQuery,
): Promise<MissedOpportunityResponse> {
  const res = await api.get(BASE, { params })
  return res.data
}

/**
 * Download the selected day as a Word document. Reuses the report's scope and
 * filters (same query params) so the file matches exactly what's on screen, and
 * honours the server-supplied filename from Content-Disposition.
 */
export async function downloadMissedOpportunitiesDoc(
  params: MissedOpportunityQuery,
  fallbackName = 'Missed_Opportunities.doc',
): Promise<void> {
  const res = await api.get(`${BASE}/export`, { params, responseType: 'blob' })
  const disposition = (res.headers?.['content-disposition'] || '') as string
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const filename = match?.[1] || fallbackName

  const blob = res.data as Blob
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export async function getMissedOpportunityRules(): Promise<MissedOpportunityRulesResponse> {
  const res = await api.get(`${BASE}/rules`)
  return res.data
}

export async function createMissedOpportunityRule(
  input: CreateRuleInput,
): Promise<MissedOpportunityRule> {
  const res = await api.post(`${BASE}/rules`, input)
  return res.data
}

export async function updateMissedOpportunityRule(
  ruleId: number,
  input: UpdateRuleInput,
): Promise<MissedOpportunityRule> {
  const res = await api.patch(`${BASE}/rules/${ruleId}`, input)
  return res.data
}

export async function saveMissedOpportunitySettings(
  input: Partial<MissedOpportunitySettings>,
): Promise<MissedOpportunitySettings> {
  const res = await api.patch(`${BASE}/settings`, input)
  return res.data
}

/**
 * Start a re-grade of a business day. Returns as soon as the run is queued — a
 * day is minutes of LLM calls, so the work continues in the background and the
 * caller follows it with {@link getMissedOpportunityRunStatus}. Omit `runDate`
 * for the prior business day.
 */
export async function runMissedOpportunities(runDate?: string): Promise<RunStartResult> {
  const res = await api.post(`${BASE}/run`, runDate ? { runDate } : {})
  return res.data
}

/** The run row for a day, or null when it was never graded — polled after a re-grade starts. */
export async function getMissedOpportunityRunStatus(
  runDate: string,
): Promise<MissedOpportunityRunStatus | null> {
  const res = await api.get(`${BASE}/run-status`, { params: { runDate } })
  return res.data
}
