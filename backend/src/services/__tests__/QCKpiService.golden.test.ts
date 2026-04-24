/**
 * Golden-slice tests for QCKpiService.
 * Pins each KPI tile + 6-month trend point from
 * docs/insights-validation/quality.md §2.1 / §2.3 for Tech Support / Feb 2026.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { QCKpiService } from '../QCKpiService'
import { closeDatabaseConnections } from '../../config/database'
import { DB_TESTS_ENABLED } from '../../__tests__/setup'

const describeDb = describe.skipIf(!DB_TESTS_ENABLED)

const SLICE_RANGE  = { start: new Date(2026, 1, 1, 0, 0, 0), end: new Date(2026, 1, 28, 23, 59, 59, 999) }
const SLICE_RANGES = {
  current: SLICE_RANGE,
  prior:   { start: new Date(2026, 0, 1, 0, 0, 0), end: new Date(2026, 0, 31, 23, 59, 59, 999) },
}
const DEPT_TECH_SUPPORT = [2]
const USER_MARC = 23

afterAll(async () => {
  if (DB_TESTS_ENABLED) await closeDatabaseConnections()
})

describeDb('QCKpiService — golden slice', () => {
  const svc = new QCKpiService()

  it('computeKpisForRange dept-scoped pins every KPI for Feb 2026', async () => {
    const { kpis, meta } = await svc.computeKpisForRange(DEPT_TECH_SUPPORT, SLICE_RANGE)
    expect(kpis.avg_qa_score!).toBeCloseTo(94.526667, 4)
    expect(kpis.audits_completed).toBe(99)
    expect(kpis.audits_assigned).toBe(300)
    expect(kpis.audit_completion_rate!).toBeCloseTo(33.0, 2)
    expect(kpis.dispute_rate!).toBeCloseTo(10.1010, 3)
    expect(kpis.dispute_upheld_rate!).toBeCloseTo(30.0, 2)
    expect(kpis.dispute_adjusted_rate!).toBeCloseTo(70.0, 2)
    expect(kpis.avg_dispute_resolution_time!).toBeCloseTo(4.7, 2)
    expect(kpis.dispute_not_upheld_rate).toBeNull()
    // critical_fail_rate counts finalized audits with critical_fail_count > 0;
    // avg_criticals_per_audit is SUM(critical_fail_count) / COUNT(finalized).
    // No audits in the slice have critical questions, so both are 0 (not null).
    expect(kpis.critical_fail_rate!).toBeCloseTo(0, 4)
    expect(kpis.avg_criticals_per_audit!).toBeCloseTo(0, 4)
    expect(meta.businessDays).toBe(20)
    expect(meta.paceTarget).toBe(15)
  })

  it('getKpiValues populates qa_score_trend = current - prior', async () => {
    const { current, prior } = await svc.getKpiValues(DEPT_TECH_SUPPORT, SLICE_RANGES)
    expect(current.avg_qa_score).not.toBeNull()
    expect(prior.avg_qa_score).not.toBeNull()
    expect(current.qa_score_trend!).toBeCloseTo(
      (current.avg_qa_score as number) - (prior.avg_qa_score as number),
      6,
    )
  })

  it('getTrends returns 6 monthly points for Tech Support / avg_qa_score', async () => {
    const trend = await svc.getTrends(DEPT_TECH_SUPPORT, ['avg_qa_score'], SLICE_RANGE.end)
    expect(trend).toHaveLength(6)
    const map = Object.fromEntries(trend.map(r => [r.label, r.avg_qa_score]))
    expect(map['Sep 25']).toBeNull()
    expect(map['Oct 25']).toBeNull()
    expect((map['Nov 25'] as number)).toBeCloseTo(90.3053, 3)
    expect((map['Dec 25'] as number)).toBeCloseTo(96.6538, 3)
    expect((map['Jan 26'] as number)).toBeCloseTo(96.7590, 3)
    expect((map['Feb 26'] as number)).toBeCloseTo(94.5267, 3)
  })

  it('getTrends with userId scopes to that agent only (slice user 23)', async () => {
    const trend = await svc.getTrends(DEPT_TECH_SUPPORT, ['avg_qa_score'], SLICE_RANGE.end, USER_MARC)
    const map = Object.fromEntries(trend.map(r => [r.label, r.avg_qa_score]))
    expect((map['Nov 25'] as number)).toBeCloseTo(96.0093, 3)
    expect((map['Dec 25'] as number)).toBeCloseTo(97.6486, 3)
    expect((map['Jan 26'] as number)).toBeCloseTo(97.9680, 3)
    expect((map['Feb 26'] as number)).toBeCloseTo(96.0674, 3)
  })
})
