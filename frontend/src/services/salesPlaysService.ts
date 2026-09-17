/**
 * Data access for the Sales Plays learning loop (Phase 2), under
 * `/api/insights/agent-activity/missed-opportunities/plays/*`. Reads use the
 * page grant; every write and the manual mine are Admin-only server-side.
 */
import { api } from './authService'
import type {
  SalesPlay,
  SalesPlaysResponse,
  SalesPlaysSettings,
  UpdatePlayInput,
} from '@/types/salesPlays'

const BASE = '/insights/agent-activity/missed-opportunities/plays'

export async function getSalesPlays(): Promise<SalesPlaysResponse> {
  const res = await api.get(BASE)
  return res.data
}

export async function saveSalesPlaysSettings(
  input: Partial<SalesPlaysSettings>,
): Promise<SalesPlaysSettings> {
  const res = await api.patch(`${BASE}/settings`, input)
  return res.data
}

export async function updateSalesPlay(
  playId: number,
  input: UpdatePlayInput,
): Promise<SalesPlay> {
  const res = await api.patch(`${BASE}/${playId}`, input)
  return res.data
}

/** Kick off the miner now (fire-and-forget; respects the toggle, roster and cap). */
export async function mineSalesPlaysNow(): Promise<{ started: boolean }> {
  const res = await api.post(`${BASE}/mine`)
  return res.data
}
