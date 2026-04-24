/**
 * Edge-case tests for the Quality readers.
 *
 * Loads `backend/prisma/test-fixtures/quality-edge-cases.sql` (rows in
 * 2024-01) into the dev DB on `beforeAll`, runs the readers against that
 * isolated period + dept range, asserts the pinned values, and cleans up
 * on `afterAll`. The 2024-01 window does not overlap any real data, so the
 * fixture cannot pollute live aggregations.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  getCategoryScores,
  getFormScores,
  getQualityDeptComparison,
  getScoreDistribution,
} from '../QCQualityData'
import { QCKpiService } from '../QCKpiService'
import pool, { closeDatabaseConnections } from '../../config/database'
import { DB_TESTS_ENABLED } from '../../__tests__/setup'

const describeDb = describe.skipIf(!DB_TESTS_ENABLED)

const DEPT_A = [99001]
const DEPT_B = [99002]
const FORM_NAME = 'EdgeCase Mixed Form'
const RANGES = {
  current: { start: new Date(2024, 0, 1, 0, 0, 0), end: new Date(2024, 0, 31, 23, 59, 59, 999) },
  prior:   { start: new Date(2023, 11, 1, 0, 0, 0), end: new Date(2023, 11, 31, 23, 59, 59, 999) },
}
const EMPTY_RANGES = {
  current: { start: new Date(2023, 5, 1, 0, 0, 0), end: new Date(2023, 5, 30, 23, 59, 59, 999) },
  prior:   { start: new Date(2023, 4, 1, 0, 0, 0), end: new Date(2023, 4, 31, 23, 59, 59, 999) },
}

async function execMulti(sql: string) {
  // Strip all `--` end-of-line comments first (mysql2 in single-statement
  // mode does not tolerate comment-only chunks), then split on `;` at end of
  // line. The fixture is plain INSERTs + BEGIN/COMMIT.
  const cleaned = sql
    .split(/\r?\n/)
    .map(line => {
      const idx = line.indexOf('--')
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join('\n')
  const stmts = cleaned
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
  for (const stmt of stmts) {
    const upper = stmt.toUpperCase()
    if (upper === 'START TRANSACTION' || upper === 'COMMIT') continue
    await pool.query(stmt)
  }
}

const FIXTURE_PATH = path.resolve(__dirname, '..', '..', '..', 'prisma', 'test-fixtures', 'quality-edge-cases.sql')

beforeAll(async () => {
  if (!DB_TESTS_ENABLED) return
  const sql = fs.readFileSync(FIXTURE_PATH, 'utf8')
  await execMulti(sql)
})

afterAll(async () => {
  if (!DB_TESTS_ENABLED) return
  // Same DELETE block as the top of the fixture, idempotent cleanup.
  await pool.query('DELETE FROM disputes WHERE submission_id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM submission_answers WHERE submission_id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM submission_metadata WHERE submission_id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM submissions WHERE id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM radio_options WHERE question_id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM form_questions WHERE id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM form_categories WHERE id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM form_metadata_fields WHERE id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM forms WHERE id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM users WHERE id BETWEEN 99000 AND 99999')
  await pool.query('DELETE FROM departments WHERE id BETWEEN 99000 AND 99999')
  await closeDatabaseConnections()
})

describeDb('QCQualityData — edge cases', () => {
  it('empty period returns empty / safe values (no NaN)', async () => {
    const buckets = await getScoreDistribution(DEPT_A, [], EMPTY_RANGES)
    expect(buckets).toEqual([])

    const cats = await getCategoryScores(DEPT_A, [], EMPTY_RANGES, 99002)
    expect(cats).toEqual([])

    const forms = await getFormScores(DEPT_A, EMPTY_RANGES)
    expect(forms).toEqual([])

    const cmp = await getQualityDeptComparison([], EMPTY_RANGES)
    expect(cmp.find(r => r.dept === 'EdgeCase Dept A')).toBeUndefined()
  })

  it('all 3 question types in one category aggregate correctly per submission', async () => {
    const cats = await getCategoryScores(DEPT_A, [FORM_NAME], RANGES, 99002)
    const row = cats.find(c => c.category === 'Edge Mixed Cat')
    expect(row).toBeDefined()
    expect(row!.audits).toBe(5)
    // earned = 30+23+21+10+0 = 84,  possible = 5 × 30 = 150
    // score  = 84/150 × 100 = 56.0
    expect(row!.avgScore!).toBeCloseTo(56.0, 1)
    // Prior period (Dec 2023) has no rows → priorScore null.
    expect(row!.priorScore).toBeNull()
  })

  it('single-row aggregation: dept B has exactly one audit and a score of 88', async () => {
    const forms = await getFormScores(DEPT_B, RANGES)
    expect(forms).toHaveLength(1)
    expect(forms[0].submissions).toBe(1)
    expect(forms[0].avgScore!).toBeCloseTo(88.0, 1)

    const cats = await getCategoryScores(DEPT_B, [FORM_NAME], RANGES, 99003)
    const row = cats.find(c => c.category === 'Edge Mixed Cat')
    expect(row).toBeDefined()
    // earned = Yes(10)+SCALE 7+RADIO good(5) = 22, possible = 30  → 73.3
    expect(row!.avgScore!).toBeCloseTo(73.3, 1)
  })

  it('all-N/A submission contributes 0 earned but does NOT divide-by-zero', async () => {
    // Category score for ONLY submission 99005 (the all-NA) by itself is hard
    // to isolate via the public reader — so we assert the aggregate
    // already-validated above includes it without throwing or returning NaN.
    const cats = await getCategoryScores(DEPT_A, [FORM_NAME], RANGES, 99002)
    const row = cats.find(c => c.category === 'Edge Mixed Cat')
    expect(row).toBeDefined()
    expect(Number.isFinite(row!.avgScore!)).toBe(true)
  })

  it('score distribution for dept A buckets the 5 fixture submissions correctly', async () => {
    const buckets = await getScoreDistribution(DEPT_A, [], RANGES)
    const map = Object.fromEntries(buckets.map(b => [b.bucket, b.count]))
    expect(map['90-100']).toBe(2)   // 100, 90
    expect(map['80-89']).toBe(1)    // 80
    expect(map['70-79']).toBe(1)    // 70
    expect(map['Below 60']).toBe(1) // 0 (all-NA)
    // DRAFT submission (99007) must NOT be counted.
    const total = Object.values(map).reduce<number>((a, b) => a + (b as number), 0)
    expect(total).toBe(5)
  })

  it('dept comparison ALL-scope shows both fixture depts including the single-row one', async () => {
    const rows = await getQualityDeptComparison([], RANGES)
    const a = rows.find(r => r.dept === 'EdgeCase Dept A')
    const b = rows.find(r => r.dept === 'EdgeCase Dept B (single-row)')
    expect(a).toBeDefined()
    expect(a!.audits).toBe(5)
    expect(a!.avgScore!).toBeCloseTo(68.0, 1)
    expect(a!.disputes).toBe(2)
    expect(b).toBeDefined()
    expect(b!.audits).toBe(1)
    expect(b!.avgScore!).toBeCloseTo(88.0, 1)
    expect(b!.disputes).toBe(0)
  })

  it('KPI tile dispute math handles small samples without NaN', async () => {
    const svc = new QCKpiService()
    const { kpis } = await svc.computeKpisForRange(DEPT_A, RANGES.current)
    expect(kpis.audits_completed).toBe(5)
    // dispute_rate = 2/5 × 100 = 40.0
    expect(kpis.dispute_rate!).toBeCloseTo(40.0, 2)
    // 1 UPHELD + 1 ADJUSTED → upheld = 1, resolved = 2, rate = 50
    expect(kpis.dispute_upheld_rate!).toBeCloseTo(50.0, 2)
    expect(kpis.dispute_adjusted_rate!).toBeCloseTo(50.0, 2)
    // Resolution times: 3 days + 1 day  = avg 2.0
    expect(kpis.avg_dispute_resolution_time!).toBeCloseTo(2.0, 2)
  })
})
