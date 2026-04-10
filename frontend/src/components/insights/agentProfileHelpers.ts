import type { AgentProfile } from '@/services/insightsQCService'

export const TL = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' } as Record<string,string>
export const TC = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' } as Record<string,string>
export const SL = { DRAFT:'Draft', SCHEDULED:'Scheduled', DELIVERED:'Delivered', AWAITING_SIGNATURE:'Awaiting Sig.', SIGNED:'Signed', FOLLOW_UP_PENDING:'Follow-Up', CLOSED:'Closed' } as Record<string,string>

export const fmtN = (v: number | null | undefined, s = '') => v == null ? '—' : `${v.toFixed(1)}${s}`

export function scoreColor(v: number | null | undefined, goal = 85, warn = 75): string {
  if (v == null) return 'text-slate-400'
  if (v >= goal) return 'text-emerald-600'
  if (v >= warn) return 'text-orange-500'
  return 'text-red-600'
}

export type FormSummaryItem = {
  form: string
  avg: number | null
  count: number
  reviews: AgentProfile['recentAudits']
}

export type TrendPoint = { label: string; value: number }
