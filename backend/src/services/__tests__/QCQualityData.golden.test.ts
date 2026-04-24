/**
 * Golden-slice integration tests for QCQualityData.
 *
 * Pins every Quality reader to the hand-computed values in
 * docs/insights-validation/quality.md §2 for the slice:
 *
 *   user 23 (Marc Joseph) × form 259 (Contact Call Review Form)
 *   × department 2 (Tech Support) × Feb 2026
 *
 * These read from the dev database. They will fail if the underlying
 * submissions / disputes for the slice change — that is the intent: any
 * unintentional data shift is surfaced as a regression.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  getCategoryScores,
  getFormScores,
  getQualityDeptComparison,
  getScoreDistribution,
} from '../QCQualityData'
import { closeDatabaseConnections } from '../../config/database'
import { DB_TESTS_ENABLED } from '../../__tests__/setup'

const describeDb = describe.skipIf(!DB_TESTS_ENABLED)

const SLICE_RANGES = {
  current: { start: new Date(2026, 1, 1, 0, 0, 0),  end: new Date(2026, 1, 28, 23, 59, 59, 999) },
  prior:   { start: new Date(2026, 0, 1, 0, 0, 0),  end: new Date(2026, 0, 31, 23, 59, 59, 999) },
}

const DEPT_TECH_SUPPORT = [2]
const USER_MARC = 23
const FORM_NAME = 'Contact Call Review Form'

afterAll(async () => {
  if (DB_TESTS_ENABLED) await closeDatabaseConnections()
})

describeDb('QCQualityData — golden slice', () => {
  it('getScoreDistribution returns the dept-wide buckets for Tech Support / Feb 2026', async () => {
    const buckets = await getScoreDistribution(DEPT_TECH_SUPPORT, [], SLICE_RANGES)
    const map = Object.fromEntries(buckets.map(b => [b.bucket, b.count]))
    expect(map['60-69']).toBe(2)
    expect(map['70-79']).toBe(4)
    expect(map['80-89']).toBe(14)
    expect(map['90-100']).toBe(79)
  })

  it('getCategoryScores agent-scoped matches every per-category score from the report', async () => {
    const cats = await getCategoryScores(DEPT_TECH_SUPPORT, [FORM_NAME], SLICE_RANGES, USER_MARC)
    const expected: Record<string, { audits: number; avgScore: number }> = {
      'Initial Greeting / Customer Verification':                { audits: 27, avgScore: 93.5 },
      'Contact Management':                                      { audits: 27, avgScore: 80.0 },
      'CRM / Knowledge Base':                                    { audits: 27, avgScore: 71.3 },
      'Product / Service Knowledge and Problem Solving Ability': { audits: 27, avgScore: 98.1 },
      'Call Transfer / Hold Procedures':                         { audits: 27, avgScore: 95.7 },
      'Wrap-Up Process':                                         { audits: 27, avgScore: 95.1 },
      'Professionalism / Rapport':                               { audits: 27, avgScore: 98.1 },
      'Ticket / Task Documentation':                             { audits: 27, avgScore: 95.3 },
      'Work From Home Policy':                                   { audits: 27, avgScore: 100.0 },
    }
    for (const [name, exp] of Object.entries(expected)) {
      const row = cats.find(c => c.category === name)
      expect(row, `category "${name}" missing`).toBeDefined()
      expect(row!.audits, `${name} audits`).toBe(exp.audits)
      expect(row!.avgScore!, `${name} avgScore`).toBeCloseTo(exp.avgScore, 1)
    }
    // Categories without YES_NO/SCALE/RADIO must NOT appear.
    expect(cats.find(c => c.category === 'Overall Feedback')).toBeUndefined()
  })

  it('getFormScores dept-scoped returns Contact Call Review Form @ 99 / 94.5', async () => {
    const forms = await getFormScores(DEPT_TECH_SUPPORT, SLICE_RANGES)
    const row = forms.find(f => f.form === FORM_NAME)
    expect(row).toBeDefined()
    expect(row!.submissions).toBe(99)
    expect(row!.avgScore!).toBeCloseTo(94.5, 1)
  })

  it('getQualityDeptComparison ALL-scope contains both departments with pinned values', async () => {
    const rows = await getQualityDeptComparison([], SLICE_RANGES)
    const tech = rows.find(r => r.dept === 'Tech Support')
    const cs   = rows.find(r => r.dept === 'Customer Service')
    expect(tech).toBeDefined()
    expect(tech!.audits).toBe(99)
    expect(tech!.avgScore!).toBeCloseTo(94.5, 1)
    expect(tech!.disputes).toBe(9)
    expect(cs).toBeDefined()
    expect(cs!.audits).toBe(205)
    expect(cs!.avgScore!).toBeCloseTo(92.9, 1)
    expect(cs!.disputes).toBe(20)
  })
})
