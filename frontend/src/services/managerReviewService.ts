import { api } from './authService'
import type { QCParams, FilterOptions } from './insightsQCService'

// Quality > Manager Review Items — gated by the `quality_manager_review` app_page.

export interface ManagerReviewKpis {
  reviews: number; reviewsFlagged: number; notes: number
}
export interface HiddenQuestionAgent { userId: number; name: string; dept: string; total: number; responses: number; flagged: number }
export interface HiddenQuestionSummary {
  key: string; form: string; question: string; type: string
  total: number; responses: number; flagged: number
  distribution: Array<{ answer: string; count: number }>
  agents: HiddenQuestionAgent[]
}
export interface ManagerReviewSummary {
  kpis: ManagerReviewKpis
  questions: HiddenQuestionSummary[]
  range: { startDate: string; endDate: string }
}
export interface HiddenAnswerRow {
  submissionId: number; date: string; status: string
  userId: number; agent: string; dept: string
  form: string; question: string; type: string
  answer: string | null; notes: string | null; flagged: boolean
}

const base = '/qa/manager-review'

export const getManagerReviewFilterOptions = async (p: QCParams): Promise<FilterOptions> =>
  (await api.get(`${base}/filter-options`, { params: p })).data

export const getManagerReviewSummary = async (p: QCParams): Promise<ManagerReviewSummary> =>
  (await api.get(`${base}/summary`, { params: p })).data

export const getManagerReviewAnswers = async (p: QCParams & { all?: '1' }): Promise<HiddenAnswerRow[]> =>
  (await api.get(`${base}/answers`, { params: p })).data
