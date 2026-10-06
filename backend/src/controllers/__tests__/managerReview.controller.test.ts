/**
 * Quality > Manager Review Items handlers. Access is enforced by
 * authorizePage('quality_manager_review', 'viewAll') on the router in
 * qa.routes.ts; these tests pin the filter plumbing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const { resolveRequestedDepts, getHiddenQuestionSummary, getHiddenAnswers, getFilterOptions } = vi.hoisted(() => ({
  resolveRequestedDepts: vi.fn(async (..._a: unknown[]) => [7]),
  getHiddenQuestionSummary: vi.fn(async (..._a: unknown[]) => ({ kpis: {}, questions: [], range: {} })),
  getHiddenAnswers: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  getFilterOptions: vi.fn(async (..._a: unknown[]) => ({ departments: [], forms: [] })),
}))
vi.mock('../../services/insightsScope', () => ({ resolveRequestedDepts }))
vi.mock('../../services/QCManagerReviewData', () => ({ getHiddenQuestionSummary, getHiddenAnswers }))
vi.mock('../../services/QCQualityData', () => ({ getFilterOptions }))
vi.mock('../insightsQC.controller', () => ({
  parseFormNames: (req: Request) => ((req.query.forms as string | undefined)?.split(',') ?? []),
}))

import {
  getManagerReviewSummary, getManagerReviewAnswers, getManagerReviewFilterOptions,
} from '../managerReview.controller'

function mockRes(): Response {
  const res: Record<string, unknown> = { statusCode: 200 }
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn(() => res)
  return res as unknown as Response
}
const req = (query: Record<string, string> = {}) =>
  ({ user: { user_id: 99, role: 'QA' }, query, params: {} } as unknown as Request)
const next = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('manager review handlers', () => {
  it('passes the department and form filters to the summary query', async () => {
    const res = mockRes()
    await getManagerReviewSummary(req({ departments: 'Sales', forms: 'Sales Interaction QA' }), res, next)
    expect(resolveRequestedDepts).toHaveBeenCalledWith('Sales')
    const [depts, forms] = getHiddenQuestionSummary.mock.calls[0]
    expect(depts).toEqual([7])
    expect(forms).toEqual(['Sales Interaction QA'])
    expect(res.json).toHaveBeenCalled()
  })

  it('defaults the answers list to notes only and honours all=1', async () => {
    await getManagerReviewAnswers(req(), mockRes(), next)
    await getManagerReviewAnswers(req({ all: '1' }), mockRes(), next)
    expect(getHiddenAnswers.mock.calls[0][3]).toEqual({ onlyFlagged: true })
    expect(getHiddenAnswers.mock.calls[1][3]).toEqual({ onlyFlagged: false })
  })

  it('serves filter options under the same filters', async () => {
    const res = mockRes()
    await getManagerReviewFilterOptions(req({ departments: '3' }), res, next)
    expect(getFilterOptions).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ departments: [], forms: [] })
  })

  it('forwards data-layer errors to the error handler', async () => {
    getHiddenQuestionSummary.mockRejectedValueOnce(new Error('db down'))
    await getManagerReviewSummary(req(), mockRes(), next)
    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })
})
