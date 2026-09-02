/**
 * Locks the base-path contract for `createInsightsApi`.
 *
 * The QC dashboards are reused verbatim for the Internal Research section — the
 * ONLY backend difference is the base path (`/insights/qc` vs `/insights/ir`,
 * the latter INTERNAL-scoped). If the factory ever stopped honouring its `base`
 * argument, Internal Research would silently render standard Quality data (a
 * confidentiality break), so every endpoint is asserted against both scopes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn(async () => ({ data: {} })) }))
vi.mock('../authService', () => ({ api: { get } }))

import { createInsightsApi } from '../insightsQCService'

// The mock is declared arg-less (keeps ESLint happy — no unused param), but
// vitest still records the arguments callers pass at runtime. Cast the recorded
// call to a value tuple so tsc lets us read the url positional.
const lastPath = () => (get.mock.calls[get.mock.calls.length - 1] as unknown[])[0] as string

const P = { period: 'current_month' }

describe('createInsightsApi base-path binding', () => {
  beforeEach(() => get.mockClear())

  it('defaults to the standard QC base', async () => {
    const api = createInsightsApi()
    await api.getQCKpis(P)
    expect(lastPath()).toBe('/insights/qc/kpis')
  })

  it('binds every endpoint to the Internal Research base when scoped to ir', async () => {
    const api = createInsightsApi('/insights/ir')
    await api.getFilterOptions(P);              expect(lastPath()).toBe('/insights/ir/filter-options')
    await api.getQCKpis(P);                     expect(lastPath()).toBe('/insights/ir/kpis')
    await api.getQCTrends(P);                   expect(lastPath()).toBe('/insights/ir/trends')
    await api.getQCAgents(P);                   expect(lastPath()).toBe('/insights/ir/agents')
    await api.getQCAgentProfile(7, P);          expect(lastPath()).toBe('/insights/ir/agent/7')
    await api.getQCAgentFull(7, P);             expect(lastPath()).toBe('/insights/ir/agent/7/full')
    await api.getScoreDistribution(P);          expect(lastPath()).toBe('/insights/ir/quality/score-distribution')
    await api.getCategoryScores(P);             expect(lastPath()).toBe('/insights/ir/quality/categories')
    await api.getMissedQuestions(P);            expect(lastPath()).toBe('/insights/ir/quality/missed-questions')
    await api.getQualityDeptComparison(P);      expect(lastPath()).toBe('/insights/ir/quality/dept-comparison')
    await api.getQAFormsCompleted(P);           expect(lastPath()).toBe('/insights/ir/quality/qa-forms-completed')
    await api.getFormScores(P);                 expect(lastPath()).toBe('/insights/ir/quality/forms')
    await api.getLowScoringAudits(P);           expect(lastPath()).toBe('/insights/ir/quality/low-scores')
    await api.getFormAgentBreakdown(3, P);      expect(lastPath()).toBe('/insights/ir/quality/forms/3/agents')
    await api.getCategoryAgentBreakdown(3, 9, P); expect(lastPath()).toBe('/insights/ir/quality/category-agents')
  })

  it('keeps the two scopes on distinct paths for the same call', async () => {
    await createInsightsApi('/insights/qc').getScoreDistribution(P)
    const qc = lastPath()
    await createInsightsApi('/insights/ir').getScoreDistribution(P)
    const ir = lastPath()
    expect(qc).not.toBe(ir)
  })
})
