/**
 * Manager Review Items handlers. These answers are hidden from the reviewed
 * agent, so the API must refuse agents and SELF-scoped grants even when the
 * ie_page configuration would let them through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const { resolveAccess, getHiddenQuestionSummary, getHiddenAnswers } = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  getHiddenQuestionSummary: vi.fn(async (..._a: unknown[]) => ({ kpis: {}, questions: [], range: {} })),
  getHiddenAnswers: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
}))
vi.mock('../../services/InsightsPermissionService', () => ({
  InsightsPermissionService: class { resolveAccess = resolveAccess },
}))
vi.mock('../../services/insightsScope', () => ({ resolveDeptFilter: vi.fn(async () => [7]) }))
vi.mock('../../config/database', () => ({ default: { execute: vi.fn(), query: vi.fn() } }))
vi.mock('../../config/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

vi.mock('../../services/QCManagerReviewData', () => ({ getHiddenQuestionSummary, getHiddenAnswers }))

import { getManagerReviewSummary, getManagerReviewAnswers } from '../insightsQCManagerReview.controller'

function mockRes(): Response {
  const res: Record<string, unknown> = { statusCode: 200 }
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn(() => res)
  return res as unknown as Response
}

const grant = (dataScope: string) => ({ canAccess: true, dataScope, departmentKeys: [7], employeeKey: null, pageId: 1 })
const req = (role: string, query: Record<string, string> = {}) =>
  ({ user: { user_id: 99, role }, query, params: {} } as unknown as Request)

beforeEach(() => {
  resolveAccess.mockReset()
  getHiddenQuestionSummary.mockClear()
  getHiddenAnswers.mockClear()
})

describe('manager review access', () => {
  it('serves a manager with a DIVISION grant', async () => {
    resolveAccess.mockResolvedValue(grant('DIVISION'))
    const res = mockRes()
    await getManagerReviewSummary(req('Manager'), res)
    expect(res.statusCode).toBe(200)
    expect(resolveAccess).toHaveBeenCalledWith(99, 5, 'qc_manager_review')
    expect(getHiddenQuestionSummary).toHaveBeenCalled()
  })

  it('rejects a SELF-scoped grant even when the page is open to it', async () => {
    resolveAccess.mockResolvedValue(grant('SELF'))
    const res = mockRes()
    await getManagerReviewSummary(req('QA'), res)
    expect(res.statusCode).toBe(403)
    expect(getHiddenQuestionSummary).not.toHaveBeenCalled()
  })

  it('rejects an agent even when an admin grants the CSR role ALL scope', async () => {
    resolveAccess.mockResolvedValue(grant('ALL'))
    const res = mockRes()
    await getManagerReviewAnswers(req('CSR'), res)
    expect(res.statusCode).toBe(403)
    expect(getHiddenAnswers).not.toHaveBeenCalled()
  })

  it('returns 403 when the page is not granted', async () => {
    resolveAccess.mockResolvedValue({ ...grant('ALL'), canAccess: false })
    const res = mockRes()
    await getManagerReviewSummary(req('Trainer'), res)
    expect(res.statusCode).toBe(403)
  })

  it('defaults the answers list to flagged items and honours all=1', async () => {
    resolveAccess.mockResolvedValue(grant('ALL'))
    await getManagerReviewAnswers(req('Admin'), mockRes())
    await getManagerReviewAnswers(req('Admin', { all: '1' }), mockRes())
    const calls = getHiddenAnswers.mock.calls
    expect(calls[0][3]).toEqual({ onlyFlagged: true })
    expect(calls[1][3]).toEqual({ onlyFlagged: false })
  })
})
