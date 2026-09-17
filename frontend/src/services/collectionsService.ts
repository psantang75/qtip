/**
 * Data access for the Collections dashboards.
 *
 * Live wiring against `/api/insights/collections/*` (admin/manager gated).
 * Response contracts match `@/types/collections`, so the pages and charts are
 * untouched. The industry benchmark curve is layered onto the touch series here
 * (single source in `collectionsBenchmarks`) rather than duplicated server-side.
 */
import { api } from './authService'
import type { ActivityParams } from '@/hooks/useActivityFilters'
import type {
  CampaignTouchResponse,
  AgentPerformanceResponse,
  CyclePerformanceResponse,
  CycleInvoicesResponse,
  FailedChargeInvoicesResponse,
} from '@/types/collections'
import { benchmarkCumulativeAt } from './collectionsBenchmarks'

export async function getCampaignTouch(
  params: ActivityParams,
  campaign = 'All Declined',
  currency = 'USD',
): Promise<CampaignTouchResponse> {
  const res = await api.get('/insights/collections/campaign-touch', {
    params: { ...params, campaign, currency },
  })
  const data = res.data as CampaignTouchResponse
  // Overlay the published industry curve at each touch (kept client-side).
  data.touches = data.touches.map(t => ({
    ...t,
    benchmarkCumulative: benchmarkCumulativeAt(t.touchSeq),
  }))
  return data
}

/**
 * Same campaign + currency contract as Cycle Performance and Campaign × Touch. This
 * report measures that population, so it has to be asked the same two questions.
 */
export async function getAgentPerformance(
  params: ActivityParams,
  campaign = 'All Declined',
  currency = 'USD',
): Promise<AgentPerformanceResponse> {
  const res = await api.get('/insights/collections/agent-performance', {
    params: { ...params, campaign, currency },
  })
  return res.data
}

export async function getCyclePerformance(
  params: ActivityParams,
  campaign = 'All Declined',
  currency = 'USD',
): Promise<CyclePerformanceResponse> {
  const res = await api.get('/insights/collections/cycle-performance', {
    params: { ...params, campaign, currency },
  })
  return res.data
}

export async function getCycleInvoices(
  params: ActivityParams,
  campaign = 'All Declined',
  result?: string,
  page: { limit?: number; offset?: number } = {},
  currency = 'USD',
): Promise<CycleInvoicesResponse> {
  const res = await api.get('/insights/collections/cycle-invoices', {
    params: {
      ...params,
      campaign,
      currency,
      ...(result ? { result } : {}),
      ...(page.limit != null ? { limit: page.limit } : {}),
      ...(page.offset != null ? { offset: page.offset } : {}),
    },
  })
  return res.data
}

export async function getFailedChargeInvoices(
  params: ActivityParams,
  campaign = 'All Declined',
  reason?: string,
  page: { limit?: number; offset?: number } = {},
  currency = 'USD',
): Promise<FailedChargeInvoicesResponse> {
  const res = await api.get('/insights/collections/failed-charge-invoices', {
    params: {
      ...params,
      campaign,
      currency,
      ...(reason ? { reason } : {}),
      ...(page.limit != null ? { limit: page.limit } : {}),
      ...(page.offset != null ? { offset: page.offset } : {}),
    },
  })
  return res.data
}
